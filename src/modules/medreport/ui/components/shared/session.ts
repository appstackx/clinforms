"use client";

/**
 * A session token for an authenticated call (approve, confirm a form map, save to the record): the
 * tab's own session when it covers the target (a launch session for this patient's episode, or a demo
 * session), otherwise a fresh demo-tenant session that is NOT stored (so a launch session in this tab is
 * never replaced). A launch session also tells the server which clinician the clinic system opened the
 * report for – approvals through it are bound to that clinician.
 */
import type { ConnectorId } from "../../../core/types";
import { api } from "../../api-client";
import { getSession } from "../../store";

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

export async function sessionTokenFor(target: SessionTarget): Promise<string> {
  const s = getSession();
  if (s && sessionCovers(target)) return s.token;
  const { session } = await api.demoSession({ purpose: "picker", ...(target.connectorId ? { connectorId: target.connectorId } : {}) });
  return session.token;
}
