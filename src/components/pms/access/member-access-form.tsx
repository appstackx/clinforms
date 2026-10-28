"use client";
/**
 * Staff access → one member (design round 2, "Member access – one person"): their role, their own exceptions to it,
 * the sites they work at and can see, signing details, and a plain-English summary of what they can and cannot do.
 * Nothing is saved until "Save access"; the server checks the permission, the locks and the revision again
 * (src/server/pms/access-screens.ts).
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Lock, Minus, Plus, X } from "lucide-react";
import { ConfirmDialog, PmsButton, PmsNotice, Switch } from "@/components/pms/ui";
import { cn } from "@/lib/utils";
import { memberLead, memberSummary, normaliseExceptions, overridesFor, type RoleOverride } from "@/modules/pms/core/access";
import {
  ACCESS_PERMISSION_DEFS,
  PMS_ROLES,
  PMS_ROLE_DESCRIPTIONS,
  PMS_ROLE_LABELS,
  accessPermissionDef,
  lockOf,
  rolePermission,
  type AccessPermission,
  type PmsRole,
} from "@/modules/pms/core/permissions";

import { SigningDetailsEditor, SigningDetailsReadOnly, type SaveSigning, type SigningDetailsValue } from "./signing-details";

export interface MemberAccessFormProps {
  member: { userId: string; name: string; email: string; role: PmsRole; twoStep: boolean };
  access: { active: boolean; allSites: boolean; sites: { siteId: string; worksAt: boolean; canSee: boolean }[]; exceptions: Partial<Record<AccessPermission, boolean>>; rev: number };
  overrides: RoleOverride[];
  sites: { id: string; name: string }[];
  /** Signing details on the member's practitioner record; `canEdit` for owners and administrators (never reception). */
  signing: SigningDetailsValue & { canEdit: boolean };
  saveSigning?: SaveSigning;
  lastChanged: string | null;
  readOnly: string | null;
  assignable: PmsRole[];
  rolesHref: string;
  staffHref: string;
  save: (input: {
    userId: string;
    role: PmsRole;
    exceptions: Partial<Record<AccessPermission, boolean>>;
    allSites: boolean;
    sites: { siteId: string; worksAt: boolean; canSee: boolean }[];
    expectedRev: number;
  }) => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
  setActive: (userId: string, active: boolean) => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function MemberAccessForm(props: MemberAccessFormProps) {
  const { member, access, overrides, sites, signing, readOnly, assignable } = props;
  const router = useRouter();
  const first = member.name.split(/\s+/)[0] || member.name;
  const [role, setRole] = React.useState<PmsRole>(member.role);
  const [exceptions, setExceptions] = React.useState<Partial<Record<AccessPermission, boolean>>>(access.exceptions);
  const [allSites, setAllSites] = React.useState(access.allSites);
  const [works, setWorks] = React.useState<Set<string>>(() => new Set(access.sites.filter((s) => s.worksAt).map((s) => s.siteId)));
  const [sees, setSees] = React.useState<Set<string>>(() => new Set(access.sites.filter((s) => s.canSee && !s.worksAt).map((s) => s.siteId)));
  const [dirty, setDirty] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = React.useState(false);
  const locked = readOnly !== null;

  const changed = () => {
    setDirty(true);
    setMessage(null);
  };
  const roleOverrides = overridesFor(role, overrides);
  const realExceptions = normaliseExceptions(role, exceptions, roleOverrides);
  const exceptionIds = Object.keys(realExceptions) as AccessPermission[];
  const summary = memberSummary(role, roleOverrides, realExceptions, access.active);
  const candidates = ACCESS_PERMISSION_DEFS.filter((d) => !lockOf(role, d.id) && !(d.id in realExceptions)).map((d) => ({
    id: d.id,
    text: `${rolePermission(role, d.id, roleOverrides) ? "Remove" : "Add"}: ${d.phrase}`,
  }));
  const seeCount = allSites ? "all" : sites.filter((s) => works.has(s.id) || sees.has(s.id)).length;
  const worksNames = sites.filter((s) => works.has(s.id)).map((s) => s.name);
  const lead = memberLead(first, role, worksNames, seeCount, sites.length, exceptionIds.length);
  const noSite = !allSites && seeCount === 0;

  const pickRole = (r: PmsRole) => {
    setRole(r);
    setExceptions({});
    changed();
  };
  const addException = (id: string) => {
    if (!id) return;
    const p = id as AccessPermission;
    setExceptions((e) => ({ ...e, [p]: !rolePermission(role, p, roleOverrides) }));
    changed();
  };
  const removeException = (p: AccessPermission) => {
    setExceptions((e) => {
      const next = { ...e };
      delete next[p];
      return next;
    });
    changed();
  };
  const toggleSet = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const onSave = async () => {
    if (noSite) {
      setMessage({ tone: "error", text: "Choose at least one site they can see, or switch on “Can see all sites”." });
      return;
    }
    setPending(true);
    const r = await props.save({
      userId: member.userId,
      role,
      exceptions: realExceptions,
      allSites,
      sites: sites.filter((s) => works.has(s.id) || sees.has(s.id)).map((s) => ({ siteId: s.id, worksAt: works.has(s.id), canSee: true })),
      expectedRev: access.rev,
    });
    setPending(false);
    if (r.ok) {
      setDirty(false);
      setMessage({ tone: "success", text: r.message });
      router.refresh();
    } else setMessage({ tone: "error", text: r.error });
  };
  const onActive = async (active: boolean) => {
    setPending(true);
    const r = await props.setActive(member.userId, active);
    setPending(false);
    setConfirmDeactivate(false);
    setMessage(r.ok ? { tone: "success", text: r.message } : { tone: "error", text: r.error });
    if (r.ok) router.refresh();
  };

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4">
      <nav aria-label="Breadcrumb" className="flex flex-wrap gap-1.5 text-[13px] text-[#64748B]">
        <span>Set-up</span>
        <span aria-hidden>/</span>
        <Link href={props.staffHref} className="text-primary-strong underline underline-offset-2">
          Staff access
        </Link>
        <span aria-hidden>/</span>
        <span aria-current="page">{member.name}</span>
      </nav>

      <section aria-label="Member" className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-white px-5 py-4">
        <Initials name={member.name} />
        <div className="flex min-w-[min(220px,100%)] flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="m-0 text-[22px] font-semibold leading-[30px]">{member.name}</h1>
            {access.active ? (
              <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-[#DCFCE7] pl-1.5 pr-2 text-xs font-medium text-[#166534]">
                <Check className="h-3 w-3" strokeWidth={2.4} aria-hidden />
                Active
              </span>
            ) : (
              <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-[#F1F5F9] pl-1.5 pr-2 text-xs font-medium text-[#334155]">
                <X className="h-3 w-3" strokeWidth={2.4} aria-hidden />
                Deactivated
              </span>
            )}
          </div>
          <span className="break-all text-[#475569]">
            {member.email} · 2-step sign-in {member.twoStep ? "on" : "off"}
          </span>
        </div>
        {locked ? null : access.active ? (
          <PmsButton variant="secondary" className="text-[#BA1C1C]" onClick={() => setConfirmDeactivate(true)} disabled={pending}>
            Deactivate
          </PmsButton>
        ) : (
          <PmsButton variant="secondary" onClick={() => onActive(true)} loading={pending}>
            Reactivate
          </PmsButton>
        )}
      </section>

      {readOnly ? <PmsNotice tone="info" title="This access can’t be changed here">{readOnly}</PmsNotice> : null}
      {!access.active ? (
        <PmsNotice tone="warning" title={`${first} can’t use the clinic system`}>
          Their clinic-system access is switched off. Their ClinForms membership is unchanged – to remove them from the clinic, use ClinForms settings → Members.
        </PmsNotice>
      ) : null}

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          <section aria-labelledby="role-h" className="flex flex-col gap-3 rounded-2xl border border-border bg-white px-5 py-4">
            <div className="flex items-center gap-2">
              <h2 id="role-h" className="m-0 flex-1 text-base font-semibold">
                Role
              </h2>
              <Link href={props.rolesHref} className="text-[13px] font-medium text-primary-strong underline underline-offset-2">
                See what each role can do
              </Link>
            </div>
            <fieldset className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(160px,100%),1fr))] gap-2 border-0 p-0" disabled={locked}>
              <legend className="sr-only">Role</legend>
              {PMS_ROLES.map((r) => {
                const on = role === r;
                const off = r === "owner" || (r !== member.role && !assignable.includes(r));
                return (
                  <label
                    key={r}
                    className={cn(
                      "flex min-h-[72px] items-start gap-2.5 rounded-[10px] border p-3",
                      on ? "border-[#0E958A] bg-[#F0FDFA]" : off ? "border-border bg-[#F8FAFC]" : "border-border bg-white",
                      off || locked ? "cursor-not-allowed" : "cursor-pointer",
                    )}
                  >
                    <input
                      type="radio"
                      name="role"
                      checked={on}
                      disabled={off && !on}
                      onChange={() => pickRole(r)}
                      className="mt-px h-[18px] w-[18px] shrink-0 accent-[#0B7970] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    />
                    <span className="flex flex-col gap-0.5">
                      <strong className="font-semibold">
                        {PMS_ROLE_LABELS[r]}
                        {r === "owner" ? " (transfer only)" : ""}
                      </strong>
                      <span className="text-xs leading-4 text-[#475569]">{PMS_ROLE_DESCRIPTIONS[r]}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </section>

          <section aria-labelledby="ex-h" className="flex flex-col gap-3 rounded-2xl border border-border bg-white px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex min-w-[min(220px,100%)] flex-1 flex-col">
                <h2 id="ex-h" className="m-0 text-base font-semibold">
                  Exceptions to the {PMS_ROLE_LABELS[role]} role
                </h2>
                <span className="text-[13px] text-[#475569]">Only for this person. Everything else follows the role.</span>
              </div>
              <label htmlFor="add-ex" className="sr-only">
                Add an exception
              </label>
              <select
                id="add-ex"
                value=""
                disabled={locked || role === "owner"}
                onChange={(e) => addException(e.target.value)}
                className="h-9 max-w-full rounded-lg border border-[#CBD5E1] bg-white px-2.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <option value="">+ Add an exception…</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.text}
                  </option>
                ))}
              </select>
            </div>
            {exceptionIds.length === 0 ? (
              <p className="m-0 rounded-[10px] border border-dashed border-[#CBD5E1] p-3.5 text-center text-[#475569]">
                No exceptions – {first} has exactly the {PMS_ROLE_LABELS[role]} permissions.
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {exceptionIds.map((p) => {
                  const added = realExceptions[p] === true;
                  return (
                    <li key={p} className={cn("flex flex-wrap items-center gap-2.5 rounded-[10px] border px-3 py-2.5", added ? "border-[#A7E8BE] bg-[#F0FDF4]" : "border-[#FECACA] bg-[#FEF2F2]")}>
                      <span
                        className={cn(
                          "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border bg-white pl-1.5 pr-2 text-xs font-semibold",
                          added ? "border-[#A7E8BE] text-[#166534]" : "border-[#FECACA] text-[#991B1B]",
                        )}
                      >
                        {added ? <Plus className="h-3 w-3" strokeWidth={2.6} aria-hidden /> : <Minus className="h-3 w-3" strokeWidth={2.6} aria-hidden />}
                        {added ? "Added" : "Removed"}
                      </span>
                      <span className="flex min-w-[min(200px,100%)] flex-1 flex-col">
                        <strong className="font-semibold">{cap(accessPermissionDef(p).phrase)}</strong>
                        <span className="text-xs text-[#475569]">
                          {added ? "Not part of the " : "Normally part of the "}
                          {PMS_ROLE_LABELS[role]} role
                        </span>
                      </span>
                      <PmsButton variant="secondary" size="sm" className="h-8" disabled={locked} onClick={() => removeException(p)}>
                        Back to role default
                      </PmsButton>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="m-0 flex items-center gap-1.5 text-xs text-[#475569]">
              <Lock className="h-3.5 w-3.5" aria-hidden />
              Locked permissions (like clinical notes for reception) can’t be added as exceptions.
            </p>
          </section>

          <section aria-labelledby="site-h" className="overflow-hidden rounded-2xl border border-border bg-white">
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
              <div className="flex min-w-[min(220px,100%)] flex-1 flex-col">
                <h2 id="site-h" className="m-0 text-base font-semibold">
                  Sites
                </h2>
                <span className="text-[13px] text-[#475569]">“Works at” puts them on that site’s rota or front desk. “Can see” decides which diaries and patients they can open.</span>
              </div>
              <Switch
                checked={allSites || role === "owner"}
                disabled={locked || role === "owner"}
                onCheckedChange={(v) => {
                  setAllSites(v);
                  changed();
                }}
                label="Can see all sites"
              />
            </div>
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[320px] border-collapse text-sm">
                <thead>
                  <tr className="bg-[#F8FAFC] text-left text-xs text-[#475569]">
                    <th scope="col" className="px-5 py-2">
                      Site
                    </th>
                    <th scope="col" className="w-[100px] px-3 py-2 text-center sm:w-[120px]">
                      Works at
                    </th>
                    <th scope="col" className="w-[100px] px-5 py-2 text-center sm:w-[120px]">
                      Can see
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sites.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-5 py-3 text-[#475569]">
                        The clinic has no sites yet.
                      </td>
                    </tr>
                  ) : null}
                  {sites.map((s) => {
                    const w = works.has(s.id);
                    const all = allSites || role === "owner";
                    const seen = all || w || sees.has(s.id);
                    return (
                      <tr key={s.id} className="border-t border-[#F1F5F9]">
                        <th scope="row" className="px-5 py-1.5 text-left font-medium">
                          {s.name}
                        </th>
                        <td className="px-3 py-0.5 text-center">
                          <label className="inline-flex min-h-[40px] min-w-[44px] cursor-pointer items-center justify-center">
                            <input
                              type="checkbox"
                              checked={w}
                              disabled={locked}
                              onChange={() => {
                                setWorks((x) => toggleSet(x, s.id));
                                changed();
                              }}
                              aria-label={`Works at ${s.name}`}
                              className="m-0 h-[18px] w-[18px] accent-[#0B7970] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            />
                          </label>
                        </td>
                        <td className="px-5 py-0.5 text-center">
                          <label className="inline-flex min-h-[40px] min-w-[44px] cursor-pointer items-center justify-center">
                            <input
                              type="checkbox"
                              checked={seen}
                              disabled={locked || all || w}
                              onChange={() => {
                                setSees((x) => toggleSet(x, s.id));
                                changed();
                              }}
                              aria-label={`Can see ${s.name}`}
                              className="m-0 h-[18px] w-[18px] accent-[#0B7970] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            />
                          </label>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className={cn("m-0 px-5 pb-3.5 pt-2.5 text-xs", noSite ? "font-medium text-[#991B1B]" : "text-[#475569]")} role={noSite ? "alert" : undefined}>
              {noSite ? "Choose at least one site they can see, or switch on “Can see all sites”." : "A site they work at is always visible to them."}
            </p>
          </section>

          <section aria-labelledby="sign-h" className="flex flex-col gap-3 rounded-2xl border border-border bg-white px-5 py-4">
            <h2 id="sign-h" className="m-0 text-base font-semibold">
              Signing details
            </h2>
            {member.role === "staff" ? (
              <p className="m-0 text-[#475569]">
                Reception never signs clinical notes. Switch the role to Clinician (and save) to add a registration number – without one, {first} can’t sign notes.
              </p>
            ) : signing.canEdit && props.saveSigning ? (
              <SigningDetailsEditor userId={member.userId} name={member.name} value={signing} save={props.saveSigning} />
            ) : (
              <SigningDetailsReadOnly name={member.name} value={signing} />
            )}
          </section>
        </div>

        <aside aria-labelledby="sum-h" className="flex min-w-0 flex-[1_1_340px] flex-col gap-3.5 rounded-2xl border border-border bg-white px-5 py-4 lg:sticky lg:top-4">
          <h2 id="sum-h" className="m-0 text-base font-semibold">
            What {first} can do
          </h2>
          <p className="m-0 text-[#334155]">{access.active ? lead : `${first}’s clinic-system access is switched off: they can’t open anything.`}</p>
          <SummaryList tone="can" title="Can" lines={summary.can} />
          <SummaryList tone="cannot" title="Cannot" lines={summary.cannot} />
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            {dirty ? (
              <span role="status" className="text-[13px] text-[#864E0E]">
                Unsaved changes
              </span>
            ) : null}
            {message ? (
              <span role={message.tone === "error" ? "alert" : "status"} className={cn("text-[13px]", message.tone === "success" ? "text-[#166534]" : "text-[#991B1B]")}>
                {message.text}
              </span>
            ) : null}
            <PmsButton size="lg" className="h-10 text-sm font-semibold" onClick={onSave} loading={pending} disabled={locked || !dirty}>
              Save access
            </PmsButton>
            <span className="text-xs text-[#475569]">{props.lastChanged ?? "Not changed yet – the role’s defaults, every site."}</span>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDeactivate}
        onOpenChange={setConfirmDeactivate}
        title={`Deactivate ${member.name}?`}
        description={`${first} won’t be able to open anything in the clinic system until someone reactivates them. Their exceptions and sites are kept. Their ClinForms membership is unchanged.`}
        confirmLabel="Deactivate"
        cancelLabel="Keep access"
        destructive
        pending={pending}
        onConfirm={() => onActive(false)}
      />
    </div>
  );
}

function Initials({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span aria-hidden className="inline-flex h-[52px] w-[52px] flex-none items-center justify-center rounded-full bg-[#FEF3C7] text-lg font-semibold text-[#864E0E]">
      {initials}
    </span>
  );
}

function SummaryList({ tone, title, lines }: { tone: "can" | "cannot"; title: string; lines: { text: string; exception: boolean }[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <strong className={cn("flex items-center gap-1.5 text-[13px]", tone === "can" ? "text-[#166534]" : "text-[#991B1B]")}>
        {tone === "can" ? <Check className="h-3.5 w-3.5" strokeWidth={2.6} aria-hidden /> : <X className="h-3.5 w-3.5" strokeWidth={2.6} aria-hidden />}
        {title}
      </strong>
      {lines.length === 0 ? (
        <p className="m-0 text-[#475569]">Nothing.</p>
      ) : (
        <ul className="m-0 flex list-disc flex-col gap-1 pl-[18px]">
          {lines.map((l) => (
            <li key={l.text}>
              {l.text}
              {l.exception ? <span className="ml-1.5 rounded bg-[#E8EEFB] px-[5px] text-[11px] font-semibold text-[#1842B4]">exception</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
