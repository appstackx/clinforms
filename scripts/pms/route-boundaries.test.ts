/**
 * Every clinic-system section (staff /app/clinic and the clinic's public pages under /clinics/<id>) has its own
 * loading.tsx (a skeleton with an accessible status) and error.tsx (a client error boundary with "Try again"),
 * and the boundaries render plain words – never the error's message – with the digest as a reference.
 */
import * as React from "react";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SectionError } from "@/components/pms/ui/section-error";
import { SectionLoading, type SectionLayout } from "@/components/pms/ui/section-loading";
import { PublicError } from "@/components/pms/portal/public-error";
import { PublicLoading } from "@/components/pms/portal/public-loading";
import DiaryError from "@/app/app/clinic/diary/error";
import PortalError from "@/app/(public-clinic)/clinics/[clinicId]/portal/error";

// The test runner compiles JSX with the classic runtime (React.createElement) – as settings-forms.test.ts does.
(globalThis as unknown as { React: typeof React }).React = React;

const ROOT = path.resolve(__dirname, "../..");
const STAFF = "src/app/app/clinic";
const PUBLIC = "src/app/(public-clinic)/clinics/[clinicId]";

const STAFF_SECTIONS = ["", "diary", "patients", "patients/[patientId]", "patients/[patientId]/(record)", "billing", "messages", "letters", "intake", "online-booking", "reports", "setup", "access", "account"];
const PUBLIC_SECTIONS = ["", "book", "booking", "portal"];

const sections = [...STAFF_SECTIONS.map((s) => path.join(STAFF, s)), ...PUBLIC_SECTIONS.map((s) => path.join(PUBLIC, s))];

describe("route boundaries – every clinic and public section", () => {
  for (const dir of sections) {
    it(`${dir} has loading.tsx and a client error.tsx`, () => {
      assert.ok(existsSync(path.join(ROOT, dir)), `${dir} exists`);
      assert.ok(existsSync(path.join(ROOT, dir, "loading.tsx")), `${dir}/loading.tsx`);
      const error = path.join(ROOT, dir, "error.tsx");
      assert.ok(existsSync(error), `${dir}/error.tsx`);
      assert.match(readFileSync(error, "utf8"), /^"use client";/, `${dir}/error.tsx is a client component`);
    });
  }
});

const boom = Object.assign(new Error("relation pms.secret_table does not exist at db.ts:42"), { digest: "123456789" });

describe("SectionError (staff)", () => {
  it("renders plain words, Try again, a way back and only the digest", () => {
    const html = renderToStaticMarkup(createElement(SectionError, { error: boom, reset: () => {}, section: "the diary", backHref: "/app/clinic/diary", backLabel: "Back to the diary" }));
    assert.match(html, /role="alert"/);
    assert.match(html, /<button[^>]*type="button"[^>]*>.*Try again<\/button>/);
    assert.match(html, /href="\/app\/clinic\/diary"[^>]*>Back to the diary</);
    assert.match(html, /Reference: 123456789/);
    assert.doesNotMatch(html, /secret_table|db\.ts|stack/i);
  });
  it("the diary's error.tsx uses it", () => {
    const html = renderToStaticMarkup(createElement(DiaryError, { error: new Error("x"), reset: () => {} }));
    assert.match(html, /Try again/);
    assert.doesNotMatch(html, /Reference:/);
  });
});

describe("PublicError (patients)", () => {
  it("renders Try again in the portal's style, without the message", () => {
    const html = renderToStaticMarkup(createElement(PublicError, { error: boom, reset: () => {}, section: "portal" }));
    assert.match(html, /Try again/);
    assert.match(html, /Reference: 123456789/);
    assert.doesNotMatch(html, /secret_table/);
    const route = renderToStaticMarkup(createElement(PortalError, { error: boom, reset: () => {} }));
    assert.match(route, /Try again/);
  });
});

describe("loading skeletons", () => {
  const layouts: SectionLayout[] = ["cards", "table", "diary", "record", "panel", "split", "form"];
  for (const layout of layouts) {
    it(`${layout}: a busy status with words for screen readers, reduced-motion bars`, () => {
      const html = renderToStaticMarkup(createElement(SectionLoading, { label: "the diary", layout }));
      assert.match(html, /role="status"/);
      assert.match(html, /aria-busy="true"/);
      assert.match(html, /<span class="sr-only">Loading the diary…<\/span>/);
      assert.match(html, /motion-reduce:animate-none/);
      assert.equal(html.match(/role="status"/g)?.length, 1, "one status, not one per row");
    });
  }
  it("public: a busy status", () => {
    const html = renderToStaticMarkup(createElement(PublicLoading, { label: "your portal" }));
    assert.match(html, /role="status"[^>]*aria-busy="true"/);
    assert.match(html, /Loading your portal…/);
  });
});
