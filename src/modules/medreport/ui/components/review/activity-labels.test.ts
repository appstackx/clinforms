/**
 * bh2 WF (AC-CPY-2): no raw action code in any activity view.
 *
 * - The review's Activity tab (activity-panel.tsx): every action the Studio records has a plain label – the declared
 *   list (KNOWN_ACTIVITY_ACTIONS, with the release's codes from core/activity-actions.ts) and every action an activity
 *   entry is written with anywhere in the module's code – and an action this build does not know reads "Updated".
 * The clinic's activity page (src/lib/activity-copy-release.ts) is tested in src/lib/activity-copy-release.test.ts.
 * Neutral wording throughout (core/wording.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RELEASE_ACTIVITY_ACTIONS } from "../../../core/activity-actions";
import { FLAG_CODE_LABELS } from "../../../core/labels";
import { KNOWN_ACTIVITY_ACTIONS } from "../../../core/report-factory";
import { CONSENT_RECORDED_ACTION, NOTES_REUSED_ACTION } from "../../../core/reuse";
import { hasBannedTerm } from "../../../core/wording";
import type { ActivityEntry } from "../../../core/types";
import { HostHooksProvider, type HostHooks } from "../../host-hooks";
import { ACTION_LABELS, ActivityPanel, UNKNOWN_ACTION_LABEL, activityDetail, activityLabel } from "./activity-panel";

// The test runner compiles JSX with the classic runtime (React.createElement).
(globalThis as unknown as { React: typeof React }).React = React;

const MODULE = path.join(process.cwd(), "src/modules/medreport");

/**
 * The action codes activity entries are written with in the module's code: a string literal in an `action:` that sits in
 * an entry with `actor` and `detail` (a code compared with === is not one).
 */
function recordedActionsInCode(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__corpus__") walk(p);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
      const src = fs.readFileSync(p, "utf8");
      for (const m of Array.from(src.matchAll(/\baction\s*:\s*/g))) {
        const start = (m.index ?? 0) + m[0].length;
        let depth = 0;
        let i = start;
        for (; i < src.length; i++) {
          const c = src[i];
          if (c === "(" || c === "[" || c === "{") depth++;
          else if (c === ")" || c === "]" || c === "}") {
            if (depth === 0) break;
            depth--;
          } else if ((c === "," || c === "\n") && depth === 0) break;
        }
        const around = src.slice(Math.max(0, (m.index ?? 0) - 300), Math.min(src.length, i + 300));
        if (!/\bactor\b/.test(around) || !/\bdetail\s*:/.test(around)) continue;
        for (const s of Array.from(src.slice(start, i).matchAll(/(?<![=!]==\s*)"([a-z][a-z_]*)"/g))) {
          found.set(s[1], [...(found.get(s[1]) ?? []), path.relative(MODULE, p)]);
        }
      }
    }
  };
  walk(MODULE);
  return found;
}

function plain(label: string, code: string): void {
  assert.ok(label.trim(), `${code}: a label`);
  assert.notEqual(label, code, `${code}: not its own code`);
  assert.doesNotMatch(label, /_|^[a-z]/, `${code}: "${label}" reads as words`);
  assert.equal(hasBannedTerm(label), false, `${code}: neutral wording`);
}

test("every action the Studio declares has a plain label – the release's decisions included", () => {
  const declared = [...KNOWN_ACTIVITY_ACTIONS, ...RELEASE_ACTIVITY_ACTIONS, CONSENT_RECORDED_ACTION, NOTES_REUSED_ACTION];
  for (const code of declared) plain(activityLabel(code), code);
  assert.equal(activityLabel("adopted"), "Adopted by the approving clinician");
  assert.equal(activityLabel("disposition_set"), "Decision recorded for a question");
  assert.equal(activityLabel("disposition_cleared"), "Decision for a question cancelled");
  assert.equal(activityLabel("approver_taken_over"), "Taken over as approver");
  assert.equal(activityLabel("note_words_accepted"), "Accepted as the note's words");
  assert.equal(activityLabel("own_words"), "Marked as own words");
  assert.equal(activityLabel("superseded"), "Replaced by a newer version");
  assert.equal(activityLabel("amendment_started"), "Amended version started");
});

test("every action an activity entry is written with in the module's code has a label", () => {
  const found = recordedActionsInCode();
  assert.ok(found.size >= 12, `found ${Array.from(found.keys()).join(", ")}`);
  for (const expected of ["created", "drafted", "edited", "gap_resolved", "answer_set", "approved", "superseded", "amendment_started", "consent_recorded"]) {
    assert.ok(found.has(expected), `found ${expected}`);
  }
  const missing = Array.from(found.keys()).filter((code) => !Object.prototype.hasOwnProperty.call(ACTION_LABELS, code));
  assert.deepEqual(missing, [], `written without a label: ${missing.map((c) => `${c} (${found.get(c)?.join(", ")})`).join("; ")}`);
});

test("an action this build does not know reads 'Updated', never its code; an answer given where there was none is 'entered'", () => {
  assert.equal(activityLabel("later_release_action"), UNKNOWN_ACTION_LABEL);
  assert.equal(activityLabel("__proto__"), UNKNOWN_ACTION_LABEL, "an object key is not a label");
  assert.equal(activityLabel("answer_set", "F-04: set to Yes (was blank)."), "Answer entered");
  assert.equal(activityLabel("answer_set", "F-04: changed to No (was Yes)."), "Answer changed");
});

test("a check's code inside an entry's details is shown by its label", () => {
  assert.equal(activityDetail("F-07: acknowledged OPINION_LANGUAGE – recorded in her own note."), `F-07: acknowledged “${FLAG_CODE_LABELS.OPINION_LANGUAGE}” – recorded in her own note.`);
  assert.equal(activityDetail("Left as written: SOME_LATER_CODE."), "Left as written: SOME_LATER_CODE.", "only codes this build knows");
});

test("the Activity tab shows no raw code for any action, known or not", () => {
  const actions = [...Object.keys(ACTION_LABELS), "later_release_action"];
  const entries: ActivityEntry[] = actions.map((action, i) => ({ at: `2026-10-2${i % 9}T10:00:00.000Z`, actor: "Sarah Reid", action, detail: "Fictional entry." }));
  const html = renderToStaticMarkup(createElement(HostHooksProvider, { hooks: {} as HostHooks } as { hooks: HostHooks; children: ReactNode }, createElement(ActivityPanel, { activity: entries })));
  const text = html.replace(/<[^>]+>/g, " ");
  // Each entry's heading is its label (newest first); no snake_case code anywhere in what is shown.
  const headings = Array.from(html.matchAll(/<p class="text-\[13px\][^"]*">([^<]*)</g), (m) => m[1].replace(/&#x27;/g, "'"));
  assert.deepEqual(headings, actions.map((a) => activityLabel(a)).reverse());
  assert.deepEqual(text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [], []);
  assert.equal(hasBannedTerm(text), false);
});
