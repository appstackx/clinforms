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
 *   disconnect  revoke at Xero (best effort: remove the connection, revoke the refresh token), wipe the tokens.
 *
 * Who: owners and admins only (the callers check mayManageXero) – the same rule as Plan and billing.
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { XERO_REQUIRED_CURRENCY, XERO_SCOPES, XERO_STATE_SECONDS } from "../../../../modules/pms/integration/xero";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { nowIso, type RepoContext } from "../../../repos/pms/context";
import { beginXeroConnect, consumeXeroState, disconnectXero, previousXeroOrg, saveXeroConnection } from "../../../repos/pms/integration/xero";
import { XeroError, type XeroClient } from "./client";

const hash = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Starts a connection: the Xero address to send the browser to, or null when Xero is off for the clinic. */
export async function startXeroConnect(ctx: RepoContext, tenantId: string, client: XeroClient, actor: PmsActor): Promise<string | null> {
  const state = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.parse(nowIso(ctx)) + XERO_STATE_SECONDS * 1000).toISOString();
  if (!(await beginXeroConnect(ctx, tenantId, hash(state), expiresAt, actor))) return null;
  return client.authorizeUrl(state, XERO_SCOPES);
}

export type CallbackResult = { ok: true; orgName: string } | { ok: false; error: "denied" | "state" | "exchange" | "no_org" | "many_orgs" | "currency" | "other_org" | "error" };

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
  // Anything that stops the connection after this point gives the tokens back to Xero (best effort).
  const giveBack = async (connectionId: string | null) => {
    if (connectionId) await client.deleteConnection(tokens.accessToken, connectionId).catch(() => undefined);
    await client.revoke(tokens.refreshToken).catch(() => undefined);
  };
  let chosenId: string | null = null;
  try {
    const all = (await client.connections(tokens.accessToken)).filter((c) => c.tenantType === "ORGANISATION");
    // Only the organisation(s) this sign-in connected (its auth event), not every one the Xero user ever connected.
    const mine = tokens.authEventId ? all.filter((c) => c.authEventId === tokens.authEventId) : all;
    if (mine.length === 0) {
      await giveBack(null);
      return { ok: false, error: "no_org" };
    }
    if (mine.length > 1) {
      for (const c of mine) await client.deleteConnection(tokens.accessToken, c.id).catch(() => undefined);
      await giveBack(null);
      return { ok: false, error: "many_orgs" };
    }
    const chosen = mine[0];
    chosenId = chosen.id;
    const before = await previousXeroOrg(ctx, tenantId);
    if (before.hasLinks && before.xeroTenantId && before.xeroTenantId !== chosen.tenantId) {
      await giveBack(chosen.id);
      return { ok: false, error: "other_org" };
    }
    const org = await client.org(tokens.accessToken, chosen.tenantId).organisation();
    if (org.baseCurrency.toUpperCase() !== XERO_REQUIRED_CURRENCY) {
      await giveBack(chosen.id);
      return { ok: false, error: "currency" };
    }
    await saveXeroConnection(
      ctx,
      tenantId,
      {
        tokens: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
        accessExpiresAt: new Date(Date.parse(nowIso(ctx)) + tokens.expiresIn * 1000).toISOString(),
        xeroTenantId: chosen.tenantId,
        connectionId: chosen.id,
        orgName: org.name || chosen.tenantName,
        baseCurrency: org.baseCurrency.toUpperCase(),
        scopes: tokens.scope,
      },
      actor,
    );
    return { ok: true, orgName: org.name || chosen.tenantName };
  } catch (err) {
    await giveBack(chosenId);
    return { ok: false, error: err instanceof XeroError && err.errorClass === "auth" ? "exchange" : "error" };
  }
}

/** Disconnects (the tokens are wiped even when Xero cannot be reached). True when something was connected. */
export async function disconnectXeroAndRevoke(ctx: RepoContext, tenantId: string, client: XeroClient | null, actor: PmsActor): Promise<boolean> {
  const wiped = await disconnectXero(ctx, tenantId, actor);
  if (!wiped) return false;
  if (client && wiped.tokens) {
    const { accessToken, refreshToken } = wiped.tokens;
    if (wiped.connectionId) await client.deleteConnection(accessToken, wiped.connectionId).catch(() => undefined);
    await client.revoke(refreshToken).catch(() => undefined);
  }
  return true;
}
