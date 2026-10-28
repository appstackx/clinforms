"use client";
/**
 * Set-up → Roles and permissions (design round 2, "Roles and permissions – grid by role"): what each role can do at
 * every site. Ticks change locally (amber outline, "N unsaved"), "Review and save" lists the changes in a confirm
 * before anything is saved; locked cells show why; "Custom" marks a cell that differs from the default. The server
 * checks the permission and the locks again (src/server/pms/access-screens.ts).
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Lock, Pencil, Undo2 } from "lucide-react";
import { ConfirmDialog, PmsButton } from "@/components/pms/ui";
import { cn } from "@/lib/utils";
import { ACCESS_GROUPS, ACCESS_PERMISSION_DEFS, PMS_ROLES, PMS_ROLE_LABELS, lockOf, roleDefault, type AccessPermission, type PmsRole } from "@/modules/pms/core/permissions";

export interface RolesGridProps {
  /** "permission|role" → allowed, as saved at this clinic (locked cells included). */
  saved: Record<string, boolean>;
  counts: Record<PmsRole, number>;
  history: { when: string; who: string; items: string[] }[];
  memberAccessHref: string;
  exportHref: string;
  save: (changes: { role: PmsRole; permission: AccessPermission; allowed: boolean }[]) => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
}

const key = (p: string, r: PmsRole) => `${p}|${r}`;
const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
const changesText = (n: number) => `${n} ${n === 1 ? "change" : "changes"}`;

export function RolesGrid({ saved, counts, history, memberAccessHref, exportHref, save }: RolesGridProps) {
  const router = useRouter();
  const [cur, setCur] = React.useState<Record<string, boolean>>(saved);
  const [confirm, setConfirm] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "success" | "error"; text: string } | null>(null);
  /** On a phone the grid shows one role at a time (the others are a tap away). */
  const [phoneRole, setPhoneRole] = React.useState<PmsRole>("staff");
  const col = (r: PmsRole) => (r === phoneRole ? "" : "hidden sm:table-cell");

  React.useEffect(() => setCur(saved), [saved]);

  const pendingChanges = React.useMemo(() => {
    const out: { role: PmsRole; permission: AccessPermission; label: string; allowed: boolean }[] = [];
    for (const d of ACCESS_PERMISSION_DEFS) {
      for (const r of PMS_ROLES) {
        const k = key(d.id, r);
        if (cur[k] !== saved[k]) out.push({ role: r, permission: d.id, label: d.label, allowed: cur[k] });
      }
    }
    return out;
  }, [cur, saved]);
  const n = pendingChanges.length;

  const toggle = (p: AccessPermission, r: PmsRole) => {
    setMessage(null);
    setCur((c) => ({ ...c, [key(p, r)]: !c[key(p, r)] }));
  };
  const resetToDefaults = () => {
    setMessage(null);
    const next: Record<string, boolean> = {};
    for (const d of ACCESS_PERMISSION_DEFS) for (const r of PMS_ROLES) next[key(d.id, r)] = lockOf(r, d.id)?.value ?? roleDefault(r, d.id);
    setCur(next);
  };
  const onSave = async () => {
    setPending(true);
    const r = await save(pendingChanges.map(({ role, permission, allowed }) => ({ role, permission, allowed })));
    setPending(false);
    setConfirm(false);
    if (r.ok) {
      setMessage({ tone: "success", text: r.message });
      router.refresh();
    } else setMessage({ tone: "error", text: r.error });
  };

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4">
      <nav aria-label="Breadcrumb" className="flex gap-1.5 text-[13px] text-[#64748B]">
        <span>Set-up</span>
        <span aria-hidden>/</span>
        <span aria-current="page">Roles and permissions</span>
      </nav>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[min(280px,100%)] flex-1 flex-col gap-0.5">
          <h1 className="m-0 text-[22px] font-semibold leading-[30px] text-foreground">Roles and permissions</h1>
          <p className="text-sm text-[#475569]">
            What each role can do across all sites. To give one person more or less, use{" "}
            <Link href={memberAccessHref} className="text-primary-strong underline underline-offset-2 hover:text-[#095E57]">
              their member access
            </Link>
            .
          </p>
        </div>
        <PmsButton variant="secondary" onClick={resetToDefaults}>
          <Undo2 aria-hidden />
          Reset to defaults
        </PmsButton>
        <PmsButton disabled={n === 0} onClick={() => n > 0 && setConfirm(true)}>
          {n > 0 ? `Review and save (${n})` : "No changes"}
        </PmsButton>
      </div>

      {n > 0 ? (
        <div role="status" className="flex flex-wrap items-center gap-2.5 rounded-xl border border-[#FBD38D] bg-[#FFFBEB] px-3.5 py-2.5 text-sm">
          <Pencil className="h-4 w-4 text-[#864E0E]" aria-hidden />
          <span className="flex-1">{changesText(n)} unsaved – changed cells have an amber outline. Nothing changes for staff until you save.</span>
          <button type="button" onClick={() => setCur(saved)} className="font-medium text-primary-strong underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            Discard
          </button>
        </div>
      ) : null}
      {message ? (
        <div
          role={message.tone === "error" ? "alert" : "status"}
          className={cn("flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm", message.tone === "success" ? "border-[#A7E8BE] bg-[#F0FDF4]" : "border-[#FECACA] bg-[#FEF2F2]")}
        >
          {message.tone === "success" ? <Check className="h-4 w-4 text-[#166534]" aria-hidden /> : null}
          <span>{message.text}</span>
        </div>
      ) : null}

      <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-[#334155]" aria-label="Key">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-flex h-[18px] w-[18px] items-center justify-center rounded bg-primary-strong text-white">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
          Allowed
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-[18px] w-[18px] rounded border-[1.5px] border-[#94A3B8] bg-white" />
          Not allowed
        </li>
        <li className="inline-flex items-center gap-1.5">
          <Lock className="h-4 w-4 text-[#475569]" aria-hidden />
          Locked – can’t be changed
        </li>
        <li className="inline-flex items-center gap-1.5">
          <CustomBadge />
          Differs from the default
        </li>
      </ul>

      <div className="flex flex-col gap-1.5 sm:hidden">
        <span id="phone-role-label" className="text-[13px] font-medium text-[#334155]">
          Show the role
        </span>
        <div role="radiogroup" aria-labelledby="phone-role-label" className="grid grid-cols-4 gap-0.5 rounded-[10px] bg-[#F1F5F9] p-[3px]">
          {PMS_ROLES.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={phoneRole === r}
              onClick={() => setPhoneRole(r)}
              className={cn(
                "h-9 rounded-lg text-[13px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                phoneRole === r ? "bg-white font-semibold text-foreground shadow-[0_1px_2px_rgba(15,23,42,.08)]" : "text-[#475569]",
              )}
            >
              {PMS_ROLE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      <div className="relative overflow-x-auto rounded-2xl border border-border bg-white">
        <table className="w-full border-collapse text-sm sm:min-w-[820px]">
          <caption className="sr-only">Permissions by role. Tick to allow.</caption>
          <thead>
            <tr className="border-b border-border bg-[#F8FAFC]">
              <th scope="col" className="bg-[#F8FAFC] px-4 py-3 sm:sticky sm:left-0 sm:z-[1] text-left text-xs font-semibold text-[#475569]">
                Permission
              </th>
              {PMS_ROLES.map((r) => (
                <th key={r} scope="col" className={cn("w-[112px] px-2 py-2.5 text-center sm:w-[140px]", col(r))}>
                  <span className="flex flex-col items-center leading-[18px]">
                    <span className="font-semibold text-foreground">{PMS_ROLE_LABELS[r]}</span>
                    <span className="text-xs font-normal text-[#64748B]">{people(counts[r])}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          {ACCESS_GROUPS.map((g) => (
            <tbody key={g}>
              <tr className="border-t border-border bg-[#F8FAFC]">
                <th scope="rowgroup" colSpan={5} className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-[0.05em] text-[#334155]">
                  {g}
                </th>
              </tr>
              {ACCESS_PERMISSION_DEFS.filter((d) => d.group === g).map((d) => (
                <tr key={d.id} className="border-t border-[#F1F5F9]">
                  <th scope="row" className="bg-white px-4 py-2.5 sm:sticky sm:left-0 sm:z-[1] text-left align-middle font-normal">
                    <span className="flex flex-col">
                      <span className="font-medium text-foreground">{d.label}</span>
                      {d.hint ? <span className="text-xs text-[#64748B]">{d.hint}</span> : null}
                    </span>
                  </th>
                  {PMS_ROLES.map((r) => {
                    const lock = lockOf(r, d.id);
                    const k = key(d.id, r);
                    if (lock) {
                      return (
                        <td key={r} className={cn("px-2 py-1.5 text-center align-middle", col(r))}>
                          <span className="inline-flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-1 py-0.5" title={lock.reason}>
                            <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", lock.value ? "text-[#166534]" : "text-[#475569]")}>
                              <Lock className="h-3.5 w-3.5" aria-hidden />
                              {lock.value ? "Always" : "Never"}
                              <span className="sr-only">
                                {" "}
                                – {PMS_ROLE_LABELS[r]}, {d.label}:
                              </span>
                            </span>
                            <span className="max-w-[128px] text-[11px] leading-[14px] text-[#475569]">{lock.reason}</span>
                          </span>
                        </td>
                      );
                    }
                    const on = Boolean(cur[k]);
                    const changed = cur[k] !== saved[k];
                    const custom = on !== roleDefault(r, d.id);
                    return (
                      <td key={r} className={cn("px-2 py-1.5 text-center align-middle", col(r))}>
                        <label
                          className={cn(
                            "inline-flex min-h-[44px] min-w-[44px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg p-1",
                            changed && "outline outline-2 -outline-offset-2 outline-[#F59F0A]",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(d.id, r)}
                            aria-label={`${d.label} – ${PMS_ROLE_LABELS[r]}${changed ? " (unsaved change)" : ""}${custom ? " (differs from the default)" : ""}`}
                            className="m-0 h-[18px] w-[18px] cursor-pointer accent-[#0B7970] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                          />
                          {custom ? <CustomBadge small /> : null}
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      <section aria-labelledby="hist-h" className="flex flex-col gap-1 rounded-2xl border border-border bg-white px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 id="hist-h" className="m-0 flex-1 text-base font-semibold">
            Change history
          </h2>
          <PmsButton asChild variant="secondary" size="sm" className="h-8 px-2.5">
            <a href={exportHref} download>
              Export log
            </a>
          </PmsButton>
        </div>
        {history.length === 0 ? (
          <p className="border-t border-[#F1F5F9] py-2.5 text-[#475569]">No changes yet – every role has the defaults shown above.</p>
        ) : (
          <ul>
            {history.map((h, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-[#F1F5F9] py-2.5">
                <span className="w-[140px] tabular-nums text-[#475569]">{h.when}</span>
                <span className="w-[130px] font-medium">{h.who}</span>
                <span className="flex min-w-[min(260px,100%)] flex-1 flex-col gap-0.5">
                  {h.items.map((t, j) => (
                    <span key={j}>{t}</span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Save ${changesText(n)}?`}
        description="These apply straight away to everyone with the role, at every site. People with their own exceptions keep them."
        confirmLabel="Save changes"
        cancelLabel="Keep editing"
        pending={pending}
        onConfirm={onSave}
      >
        <ul className="flex flex-col gap-1.5">
          {pendingChanges.map((c) => (
            <li key={key(c.permission, c.role)} className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border px-2.5 py-2">
              <span className="w-[84px] font-semibold">{PMS_ROLE_LABELS[c.role]}</span>
              <span className="min-w-[140px] flex-1">{c.label}</span>
              <span className={cn("inline-flex h-[22px] items-center whitespace-nowrap rounded-full px-2 text-xs font-medium", c.allowed ? "bg-[#DCFCE7] text-[#166534]" : "bg-[#FEE2E2] text-[#991B1B]")}>
                {c.allowed ? "Allowed" : "Not allowed"}
              </span>
              <span className="w-full text-xs text-[#475569]">Affects {people(counts[c.role])}</span>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </div>
  );
}

function CustomBadge({ small }: { small?: boolean }) {
  return (
    <span aria-hidden className={cn("rounded bg-[#E8EEFB] font-semibold text-[#1842B4]", small ? "px-1 text-[10px] leading-[15px]" : "px-[5px] text-[11px] leading-[18px]")}>
      Custom
    </span>
  );
}
