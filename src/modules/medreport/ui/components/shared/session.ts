"use client";

/**
 * A session token for an authenticated call (approve, confirm a form map, save to the record): the
 * tab's own session when it covers the target (a launch session for this patient's episode, or a demo
 * session), otherwise a fresh demo-tenant session that is NOT stored (so a launch session in this tab is
 * never replaced). A launch session also tells the server which clinician the clinic system opened the
 * report for – approvals through it are bound to that clinician. In a clinic's own Studio (server storage) the
 * answer is null unless the tab holds that clinic's launch session: the sign-in cookie identifies the member.
 */
import type { ConnectorId } from "../../../core/types";
import { api } from "../../api-client";
import { getSession, getStoreMode } from "../../store";

export interface SessionTarget {
  tenantId: string;
  connectorId?: ConnectorId;
  patientId?: string;
  episodeId?: string;
}

/** Whether the stored session can be used for this target. */
export function sessionCovers(target: SessionTarget): boolean {
  const s = getSession();
  if (!s || s.claims.tenantId !== target.tenantId) return false;
  if (target.connectorId && s.claims.connectorId && s.claims.connectorId !== target.connectorId) return false;
  if (s.claims.kind === "demo") return true;
  return s.claims.patientId === target.patientId && s.claims.episodeId === target.episodeId;
}

export async function sessionTokenFor(target: SessionTarget): Promise<string | null> {
  const s = getSession();
  if (s && sessionCovers(target)) return s.token;
  // A clinic's own Studio (server storage): the member's sign-in cookie is the caller – no demo session is
  // minted (the public demo may be switched off on this site), and none is sent.
  if (getStoreMode() === "server") return null;
  const { session } = await api.demoSession({ purpose: "picker", ...(target.connectorId ? { connectorId: target.connectorId } : {}) });
  return session.token;
}
