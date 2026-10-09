import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFormDefinition } from "../../../core/forms";
import { createQuestionSet, isQuestionAnchor, parsePortalQuestions, questionAnchor } from "../../../core/question-set";
import { FormFieldSchema } from "../../../core/schemas";
import { defaultAnchor, newField } from "./mapping";

test("a question added to a portal question set gets the next free virtual anchor, and the map still checks", async () => {
  assert.deepEqual(defaultAnchor("questions"), questionAnchor(0));
  const form = await createQuestionSet({
    referrer: { name: "Northbridge Health Insurance (fictional)", type: "insurer" },
    questions: parsePortalQuestions("Date of birth\nCurrent symptoms\nPrognosis").questions,
    now: new Date("2026-10-09T10:00:00.000Z"),
  });
  const added = newField(form, "Plan");
  assert.equal(added.id, "F-04");
  assert.deepEqual(added.anchor, questionAnchor(3));
  assert.ok(isQuestionAnchor(added.anchor));
  assert.ok(FormFieldSchema.safeParse(added).success);
  // Removing a question and adding another never reuses a place that is still taken.
  const fewer = { ...form, fields: form.fields.filter((f) => f.id !== "F-02") };
  assert.deepEqual(newField(fewer).anchor, questionAnchor(3));
  assert.deepEqual(checkFormDefinition({ ...form, fields: [...form.fields, added] }), []);
});
