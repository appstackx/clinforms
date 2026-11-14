/**
 * Xero sync (xe03): connecting a clinic's Xero organisation – standard OAuth 2.0 authorisation-code flow with the
 * client secret on the server (docs/clinic-system/decisions/xero-sync-scope.md "Connection, scopes and tokens").
 *
 *   start    the owner / admin presses Connect: a random 256-bit state is made, its SHA-256 stored on the clinic's
 *            connection row with the member's session (10 minutes), and the browser is sent to Xero.
 *   callback Xero sends the browser back with ?code&state: the state must hash to the stored one, for the SAME clinic,
 *            member and session, unexpired – and is used up by that check (single use). Then the code is exchanged,
 *            the organisation picked (exactly one, from this sign-in), its currency checked (GBP only), and the tokens
 *            stored encrypted. Anything else ends at the set-up page with a plain-English ?error=.
 *   disconnect  remove THIS clinic's connection at Xero, revoke the refresh token only when the Xero user has no other
 *            connection left (revoking ends them all), wipe the tokens.
 *
 * Who: owners and admins only (the callers check mayManageXero) – the same rule as Plan and billing.
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { XERO_REQUIRED_CURRENCY, XERO_SCOPES, XERO_STATE_SECONDS } from "../../../../modules/pms/integration/xero";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { nowIso, type RepoContext } from "../../../repos/pms/context";
import { beginXeroConnect, consumeXeroState, disconnectXero, previousXeroOrg, saveXeroConnection, xeroOrgInUseElsewhere } from "../../../repos/pms/integration/xero";
import { XeroError, type XeroClient, type XeroConnectionInfo } from "./client";

const hash = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Starts a connection: the Xero address to send the browser to, or null when Xero is off for the clinic. */
export async function startXeroConnect(ctx: RepoContext, tenantId: string, client: XeroClient, actor: PmsActor): Promise<string | null> {
  const state = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.parse(nowIso(ctx)) + XERO_STATE_SECONDS * 1000).toISOString();
  if (!(await beginXeroConnect(ctx, tenantId, hash(state), expiresAt, actor))) return null;
  return client.authorizeUrl(state, XERO_SCOPES);
}

export type CallbackResult = { ok: true; orgName: string } | { ok: false; error: "denied" | "state" | "exchange" | "no_org" | "many_orgs" | "currency" | "other_org" | "org_in_use" | "error" };

/** Finishes a connection from Xero's redirect (query parameters as given). */
export async function finishXeroConnect(ctx: RepoContext, tenantId: string, client: XeroClient, actor: PmsActor, query: URLSearchParams): Promise<CallbackResult> {
  const state = query.get("state") ?? "";
  // The state is checked (and used up) FIRST – even for an error answer – so a forged redirect changes nothing.
  if (!state || state.length > 200 || !(await consumeXeroState(ctx, tenantId, hash(state), actor))) return { ok: false, error: "state" };
  if (query.get("error")) return { ok: false, error: "denied" };
  const code = query.get("code") ?? "";
  if (!code || code.length > 2000) return { ok: false, error: "exchange" };
  let tokens;
  try {
    tokens = await client.exchangeCode(code);
  } catch {
    return { ok: false, error: "exchange" };
  }
  // Without the auth-event claim we cannot tell this sign-in's organisations from the Xero user's others: refuse, and
  // touch nothing at Xero (deleting or revoking could cut another clinic's connection).
  if (!tokens.authEventId) return { ok: false, error: "error" };
  const t = tokens;
  /** Removes only connections this sign-in made, whose organisation no other clinic uses; then lets go of the tokens. */
  const giveBack = async (conns: readonly XeroConnectionInfo[]) => {
    for (const c of conns) if (!(await xeroOrgInUseElsewhere(ctx, tenantId, c.tenantId).catch(() => true))) await client.deleteConnection(t.accessToken, c.id).catch(() => undefined);
    await revokeIfAlone(client, t.accessToken, t.refreshToken);
  };
  let mine: XeroConnectionInfo[] = [];
  try {
    const all = (await client.connections(t.accessToken)).filter((c) => c.tenantType === "ORGANISATION");
    // Only the organisation(s) this sign-in connected (its auth event), not every one the Xero user ever connected.
    mine = all.filter((c) => c.authEventId === t.authEventId);
    if (mine.length === 0) {
      await giveBack([]);
      return { ok: false, error: "no_org" };
    }
    if (mine.length > 1) {
      await giveBack(mine);
      return { ok: false, error: "many_orgs" };
    }
    const chosen = mine[0];
    // One organisation, one clinic: never two clinics posting into one ledger. Its connection is left alone.
    if (await xeroOrgInUseElsewhere(ctx, tenantId, chosen.tenantId)) {
      await revokeIfAlone(client, t.accessToken, t.refreshToken);
      return { ok: false, error: "org_in_use" };
    }
    const before = await previousXeroOrg(ctx, tenantId);
    if (before.hasLinks && before.xeroTenantId && before.xeroTenantId !== chosen.tenantId) {
      await giveBack([chosen]);
      return { ok: false, error: "other_org" };
    }
    const org = await client.org(t.accessToken, chosen.tenantId).organisation();
    if (org.baseCurrency.toUpperCase() !== XERO_REQUIRED_CURRENCY) {
      await giveBack([chosen]);
      return { ok: false, error: "currency" };
    }
    await saveXeroConnection(
      ctx,
      tenantId,
      {
        tokens: { accessToken: t.accessToken, refreshToken: t.refreshToken },
        accessExpiresAt: new Date(Date.parse(nowIso(ctx)) + t.expiresIn * 1000).toISOString(),
        xeroTenantId: chosen.tenantId,
        connectionId: chosen.id,
        orgName: org.name || chosen.tenantName,
        baseCurrency: org.baseCurrency.toUpperCase(),
        scopes: t.scope,
      },
      actor,
    );
    return { ok: true, orgName: org.name || chosen.tenantName };
  } catch (err) {
    await giveBack(mine.length === 1 ? mine : []);
    return { ok: false, error: err instanceof XeroError && err.errorClass === "auth" ? "exchange" : "error" };
  }
}

/**
 * Revokes the refresh token ONLY when the Xero user has no other connection to this app left: revoking ends every
 * connection of the grant, which may include another clinic's. When that cannot be checked, nothing is revoked.
 */
async function revokeIfAlone(client: XeroClient, accessToken: string, refreshToken: string): Promise<void> {
  let left: XeroConnectionInfo[];
  try {
    left = await client.connections(accessToken);
  } catch {
    return;
  }
  if (left.length === 0) await client.revoke(refreshToken).catch(() => undefined);
}

/** Disconnects (the tokens are wiped even when Xero cannot be reached). True when something was connected. */
export async function disconnectXeroAndRevoke(ctx: RepoContext, tenantId: string, client: XeroClient | null, actor: PmsActor): Promise<boolean> {
  const wiped = await disconnectXero(ctx, tenantId, actor);
  if (!wiped) return false;
  if (client && wiped.tokens) {
    const { accessToken, refreshToken } = wiped.tokens;
    // Only this clinic's own connection is removed; the token is revoked only if nothing else uses it.
    if (wiped.connectionId) await client.deleteConnection(accessToken, wiped.connectionId).catch(() => undefined);
    await revokeIfAlone(client, accessToken, refreshToken);
  }
  return true;
}
