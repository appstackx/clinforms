import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel } from "@/components/account/shell";
import { ACTIVITY_ACTORS, ACTIVITY_COPY, ACTIVITY_GROUPS, activityLabel } from "@/lib/activity-copy";
import {
  ACTIVITY_EXPORT_PATH,
  ACTIVITY_PATH,
  activityHref,
  activityPeople,
  activityQuery,
  activityScope,
  activityTime,
  loadActivityLookups,
  loadActivityPage,
  parseActivityParams,
  presentActivity,
  type PersonOption,
} from "@/server/admin/activity";
import { requireAppContext } from "@/server/auth/session";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Activity" };

const SELECT =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30";
const PAGER =
  "inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700";

export default async function ActivityPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { session, membership } = await requireAppContext();
  const viewer = { tenantId: membership.tenantId, organizationId: membership.organizationId, role: membership.role, userId: session.user.id };
  const scope = activityScope(viewer);
  const params = parseActivityParams(searchParams);
  const query = activityQuery(scope, params);
  const db = getDb();
  const page = await loadActivityPage({ db }, query);
  const [lookups, people] = await Promise.all([
    loadActivityLookups(db, viewer, page.entries),
    scope.everyone ? activityPeople(db, viewer.organizationId) : Promise.resolve([] as PersonOption[]),
  ]);
  const rows = presentActivity(page.entries, lookups);
  // Filters carried by every link (the person filter only for those who may use it).
  const filters = { action: query.action, user: scope.everyone ? query.userId : null, saves: params.saves };
  const filtered = Boolean(filters.action || filters.user || filters.saves);
  const paged = Boolean(params.before || params.after);
  const knownActions = new Set(ACTIVITY_GROUPS.flatMap((g) => g.actions));
  const personChoices =
    filters.user && !people.some((p) => p.userId === filters.user)
      ? [...people, { userId: filters.user, label: lookups.users.get(filters.user)?.name ?? ACTIVITY_ACTORS.formerMember }]
      : people;

  return (
    <>
      <PageHeader title={ACTIVITY_COPY.title} description={scope.everyone ? ACTIVITY_COPY.managerIntro : ACTIVITY_COPY.memberIntro} />

      <Panel className="mb-6">
        <form method="get" action={ACTIVITY_PATH} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-3 sm:order-last">
            <input type="checkbox" name="saves" value="1" defaultChecked={filters.saves} className="h-4 w-4 rounded border-slate-300 text-teal-700" />
            {ACTIVITY_COPY.includeSaves}
          </label>
          <div className="space-y-1.5">
            <label htmlFor="activity-action" className="block text-sm font-medium text-slate-800">
              {ACTIVITY_COPY.filterAction}
            </label>
            <select id="activity-action" name="action" defaultValue={filters.action ?? ""} className={SELECT}>
              <option value="">{ACTIVITY_COPY.allActions}</option>
              {ACTIVITY_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.actions.map((action) => (
                    <option key={action} value={action}>
                      {activityLabel(action)}
                    </option>
                  ))}
                </optgroup>
              ))}
              {filters.action && !knownActions.has(filters.action) ? <option value={filters.action}>{activityLabel(filters.action)}</option> : null}
            </select>
          </div>
          {scope.everyone ? (
            <div className="space-y-1.5">
              <label htmlFor="activity-user" className="block text-sm font-medium text-slate-800">
                {ACTIVITY_COPY.filterPerson}
              </label>
              <select id="activity-user" name="user" defaultValue={filters.user ?? ""} className={SELECT}>
                <option value="">{ACTIVITY_COPY.everyone}</option>
                {personChoices.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="hidden sm:block" aria-hidden />
          )}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
            >
              {ACTIVITY_COPY.apply}
            </button>
            {filtered ? (
              <Link href={ACTIVITY_PATH} className="text-sm font-medium text-teal-700 underline-offset-4 hover:underline">
                {ACTIVITY_COPY.clear}
              </Link>
            ) : null}
          </div>
        </form>
      </Panel>

      <Panel>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-600">{filtered || paged ? ACTIVITY_COPY.empty : ACTIVITY_COPY.emptyAll}</p>
        ) : (
          <>
            <p className="mb-2 text-xs text-slate-500">
              {ACTIVITY_COPY.timesNote}
              {query.excludeActions.length > 0 ? (
                <>
                  {" "}
                  {ACTIVITY_COPY.savesHidden}{" "}
                  <Link href={activityHref(ACTIVITY_PATH, { ...filters, saves: true })} className="font-medium text-teal-700 underline-offset-4 hover:underline">
                    {ACTIVITY_COPY.showSaves}
                  </Link>
                </>
              ) : null}
            </p>
            <ul className="divide-y divide-slate-100">
              {rows.map((row) => (
                <li key={row.id} className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
                  <time dateTime={row.at} className="text-xs text-slate-500 sm:pt-0.5 sm:text-sm">
                    {activityTime(row.at)}
                  </time>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      <Link
                        href={activityHref(ACTIVITY_PATH, { action: row.action, user: filters.user })}
                        className="underline-offset-4 hover:text-teal-800 hover:underline"
                        title="Show only this action"
                      >
                        {row.label}
                      </Link>
                    </p>
                    <p className="mt-0.5 break-words text-sm text-slate-600">
                      {[`By ${row.who}`, row.target, row.detail].filter((part): part is string => Boolean(part)).join(" · ")}
                      {row.targetHref ? (
                        <>
                          {" · "}
                          <Link href={row.targetHref} className="font-medium text-teal-700 underline-offset-4 hover:underline">
                            {ACTIVITY_COPY.openTarget}
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        <nav aria-label="Activity pages" className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap gap-2">
            {page.newerCursor ? (
              <Link href={activityHref(ACTIVITY_PATH, { ...filters, after: page.newerCursor })} className={PAGER} rel="prev">
                ← {ACTIVITY_COPY.newer}
              </Link>
            ) : null}
            {paged ? (
              <Link href={activityHref(ACTIVITY_PATH, filters)} className={PAGER}>
                {ACTIVITY_COPY.newest}
              </Link>
            ) : null}
            {page.olderCursor ? (
              <Link href={activityHref(ACTIVITY_PATH, { ...filters, before: page.olderCursor })} className={PAGER} rel="next">
                {ACTIVITY_COPY.older} →
              </Link>
            ) : null}
          </div>
          {rows.length > 0 ? (
            <div className="text-right">
              {/* A plain link, not next/link: a download must never be prefetched (each one is recorded). */}
              <a
                href={activityHref(ACTIVITY_EXPORT_PATH, { ...filters, from: rows[0].id, to: rows[rows.length - 1].id })}
                className="text-sm font-medium text-teal-700 underline-offset-4 hover:underline"
                download
              >
                {ACTIVITY_COPY.download}
              </a>
              <p className="mt-0.5 text-xs text-slate-500">{ACTIVITY_COPY.downloadNote}</p>
            </div>
          ) : null}
        </nav>
      </Panel>
    </>
  );
}
