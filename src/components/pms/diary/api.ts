/**
 * The diary's reads from the browser (the route handlers under /app/clinic/diary/api). Each answers
 * { data } or { error: { message } }; a failure becomes a plain message. Browser-safe (no server imports).
 */
import { CLINIC_BASE_PATH } from "@/modules/pms/core/modules";

export const DIARY_PATH = `${CLINIC_BASE_PATH}/diary`;
const API = `${DIARY_PATH}/api`;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function read<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { cache: "no-store", credentials: "same-origin", ...init });
    const body = (await res.json().catch(() => null)) as { data?: T; error?: { message?: string } } | null;
    if (res.ok && body && "data" in body) return { ok: true, data: body.data as T };
    return { ok: false, error: body?.error?.message ?? "Could not load this. Check your connection and try again." };
  } catch {
    return { ok: false, error: "Could not load this. Check your connection and try again." };
  }
}

export const diaryApi = {
  appointment: <T>(id: string) => read<T>(`${API}/appointments/${encodeURIComponent(id)}`),
  searchPatients: <T>(q: string) => read<T>(`${API}/patients`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q }) }),
  bookingOptions: <T>(patientId: string) => read<T>(`${API}/patients/${encodeURIComponent(patientId)}`),
  bookingCheck: <T>(params: Record<string, string | number | null | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
    return read<T>(`${API}/booking-check?${q.toString()}`);
  },
  waitingEntry: <T>(id: string) => read<T>(`${API}/waiting-list/${encodeURIComponent(id)}`),
};
