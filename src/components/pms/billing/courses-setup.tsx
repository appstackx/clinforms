"use client";
/**
 * Set-up → Courses (PK02): the blocks of sessions the clinic sells up front – which services each covers, how many
 * sessions, the price and how long it is valid from the sale. A course is switched off (no longer on sale), never
 * deleted; courses already sold keep their sessions and expiry. The server checks every save again.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Checkbox, FormField, PmsNotice, SelectInput, Switch, TextInput } from "@/components/pms/ui";
import { ScrollRegion } from "@/components/pms/ui/scroll-region";
import { saveCourseTypeAction } from "@/app/app/clinic/setup/actions";
import type { CourseTypesScreen, CourseTypeView } from "@/modules/pms/billing/courses";
import { formatPence } from "@/modules/pms/core/text";
import { SetupCard, SetupError, SetupFormBar, SetupGrid, SetupHeader, SetupPage, setupFocus, useSetupForm } from "@/components/pms/reporting/setup-kit";

const BASE = "/app/clinic/setup";
const VAT_LABELS: Record<string, string> = { exempt: "Exempt (healthcare)", standard: "Standard rate", reduced: "Reduced rate", zero: "Zero rate" };

export function CoursesSetup({ screen, courseId }: { screen: CourseTypesScreen; courseId: string | null }) {
  const router = useRouter();
  const chosen = courseId === "new" ? null : (screen.types.find((t) => t.id === courseId) ?? null);
  const showForm = screen.canEdit && (courseId === "new" || chosen !== null);
  return (
    <SetupPage>
      <SetupHeader
        title="Courses"
        description="Blocks of sessions patients pay for up front. Sell one from the patient's Invoices tab; visits it covers are then used from it instead of invoiced."
        action={
          screen.canEdit ? (
            <Link href={`${BASE}/courses?course=new`} scroll={false} data-testid="add-course" className={`inline-flex h-9 items-center rounded-[8px] bg-primary-strong px-3.5 text-sm font-medium text-white hover:bg-[#095E57] ${setupFocus}`}>
              Add course
            </Link>
          ) : null
        }
      />
      {!screen.canEdit ? <p className="text-sm text-[#475569]">Only an owner, or an administrator who works at every site, can change these.</p> : null}
      {showForm ? <CourseForm key={chosen?.id ?? "new"} course={chosen} screen={screen} onDone={() => router.push(`${BASE}/courses`)} /> : null}
      {screen.types.length === 0 ? (
        <PmsNotice tone="info" title="No courses yet">
          Add a course, for example &quot;6 follow-ups&quot; at a set price, valid for six months.
        </PmsNotice>
      ) : (
        <ScrollRegion label="Courses" className="relative overflow-x-auto rounded-2xl border border-border bg-white">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <caption className="sr-only">Courses</caption>
            <thead>
              <tr className="bg-[#F8FAFC] text-left text-xs font-semibold text-[#475569]">
                <th scope="col" className="px-4 py-2.5">Course</th>
                <th scope="col" className="px-4 py-2.5">Sessions, services and validity</th>
                <th scope="col" className="px-4 py-2.5 text-right">Price</th>
                <th scope="col" className="px-4 py-2.5">
                  <span className="sr-only">Change</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {screen.types.map((t) => (
                <tr key={t.id} className="border-t border-[#F1F5F9]" data-testid="course-type-row">
                  <td className="px-4 py-2.5 font-medium">{t.active ? t.name : `${t.name} (switched off)`}</td>
                  <td className="px-4 py-2.5 text-[#334155]">{t.summary}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPence(t.pricePence)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {screen.canEdit ? (
                      <Link href={`${BASE}/courses?course=${t.id}`} scroll={false} className={`text-primary-strong underline underline-offset-2 ${setupFocus}`}>
                        Change<span className="sr-only"> {t.name}</span>
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </SetupPage>
  );
}

function CourseForm({ course, screen, onDone }: { course: CourseTypeView | null; screen: CourseTypesScreen; onDone: () => void }) {
  const f = useSetupForm({
    name: course?.name ?? "",
    serviceIds: course?.serviceIds ?? [],
    sessions: String(course?.sessions ?? 6),
    price: course ? (course.pricePence / 100).toFixed(2) : "",
    vatCode: course?.vatCode ?? "exempt",
    validDays: course?.validDays === null || course?.validDays === undefined ? (course ? "" : "180") : String(course.validDays),
    active: course?.active ?? true,
  });
  const e = f.fieldErrors;
  const services = screen.services.filter((s) => s.active || f.values.serviceIds.includes(s.id));
  const toggle = (id: string, on: boolean) => f.set("serviceIds", on ? [...f.values.serviceIds, id] : f.values.serviceIds.filter((x) => x !== id));
  return (
    <SetupCard title={course ? course.name : "New course"}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          void f.submit(() => saveCourseTypeAction({ courseTypeId: course?.id ?? null, rev: course?.rev, ...f.values }), course ? "Course saved." : `${f.values.name} added.`, onDone);
        }}
        data-testid="course-type-form"
      >
        <SetupGrid>
          <FormField id="course-name" label="Name" required error={e.name}>
            <TextInput value={f.values.name} onChange={(ev) => f.set("name", ev.target.value)} maxLength={120} data-testid="course-name" />
          </FormField>
          <FormField id="course-sessions" label="Sessions" required error={e.sessions}>
            <TextInput inputMode="numeric" value={f.values.sessions} onChange={(ev) => f.set("sessions", ev.target.value)} data-testid="course-sessions" />
          </FormField>
          <FormField id="course-price" label="Price (£)" required error={e.pricePence}>
            <TextInput inputMode="decimal" value={f.values.price} onChange={(ev) => f.set("price", ev.target.value)} data-testid="course-price" />
          </FormField>
          <FormField id="course-valid" label="Valid for (days)" hint="From the day it is sold. Leave empty for no expiry." error={e.validDays}>
            <TextInput inputMode="numeric" value={f.values.validDays} onChange={(ev) => f.set("validDays", ev.target.value)} data-testid="course-valid" />
          </FormField>
          {screen.vatRegistered ? (
            <FormField id="course-vat" label="VAT" error={e.vatCode}>
              <SelectInput value={f.values.vatCode} onChange={(ev) => f.set("vatCode", ev.target.value as typeof f.values.vatCode)}>
                {Object.entries(VAT_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </SelectInput>
            </FormField>
          ) : null}
        </SetupGrid>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold text-foreground">Services it covers</legend>
          {services.length === 0 ? (
            <p className="text-sm text-[#475569]">
              Add services first under{" "}
              <Link href={`${BASE}/services`} className={`text-primary-strong underline underline-offset-2 ${setupFocus}`}>
                Services
              </Link>
              .
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-2">
              {services.map((s) => (
                <Checkbox key={s.id} id={`course-svc-${s.id}`} checked={f.values.serviceIds.includes(s.id)} onChange={(ev) => toggle(s.id, ev.target.checked)} data-testid="course-service" label={s.active ? s.name : `${s.name} (switched off)`} />
              ))}
            </div>
          )}
          {e.serviceIds ? (
            <p role="alert" className="text-sm text-destructive-strong">
              {e.serviceIds}
            </p>
          ) : null}
        </fieldset>
        {course ? <Switch id="course-active" checked={f.values.active} onCheckedChange={(v) => f.set("active", v)} label={f.values.active ? "On sale" : "Switched off (not on sale)"} /> : null}
        {course ? <p className="text-sm text-[#475569]">Changes apply to courses sold from now on. Courses already sold keep their sessions and expiry.</p> : null}
        <SetupError error={f.error} />
        <SetupFormBar dirty={f.dirty || !course} saving={f.saving} onDiscard={course ? f.discard : onDone} discardable saveLabel={course ? "Save" : "Add course"} testId="course-save" />
      </form>
    </SetupCard>
  );
}
