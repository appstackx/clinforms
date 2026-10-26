# Safety corpus (W0.2)

The pinned safety corpus for the Blue Heart release (plan `bh-quality-plan`, W0.2). Every case pins one behaviour
that must always hold – a drafted opinion that must block, a faithful line that must pass, an action staff must not be
able to take, a printed default that must not be issued – in ClinForms' own fictional wording.

Fictional data only: Owen Testcase and Gemma Whitlock (patients), Sarah Reid, Tom Ellis and Priya Shah (clinicians,
made-up `PH-DEMO-0N` numbers), Pat Morgan (staff), Chris Dale (administrator without may-sign). Never a referrer's
wording – see "Third-party wording" below.

## Layout

| Path | What |
|---|---|
| `cases/*.jsonl` | The cases, one JSON object per line (format below). Grouped by area: `opn`, `neg`, `com`, `att`, `role`, `issue`, `cond`, `text`, `edit`, `rep`, `assemble` (META, BAND, SCALE, ASAT), `scope`, `fill`, `lint`, `probe`. |
| `fixtures/people.json`, `fixtures/bundles/*.json` | The fictional clinic, members and episodes. |
| `fixtures/fictional-forms/*.json` | Synthetic referrer forms (layout + map) with the KINDS of fields real forms have: narrow cells, single and multi choice, yes/no with supporting text, conditional boxes (lettered, "Only if … not …", "either question above"), an opinion box, an assessor sign-off, a registration-number box, a printed list, a session table, initial/current columns, a pre-printed mark and ☒, a printed default, a "To return to …" frame, a postcode label column, a navy label, a negative right indent, merge codes. The Word file is generated from the layout. |
| `safety-corpus.lock.json` | sha256 of (id, input, expectation) for every case. |
| `pending.json` | What may still fail, each with its owner workstream and why. **Only the integrator edits it; it is empty at release.** |
| `ledger.json` | Every allow hook, exemption, pre-strip, threshold, acknowledgement rule and one-click generator, with its owner. |
| `allowlist.json` | Differential-gate exceptions. Each needs Khuram's recorded approval. |
| `retired.json` | Locked rows that cannot hold as written, retired (never edited or deleted) with the reason, the decision and the case(s) that supersede them (`harness/retired.ts`). **Only the integrator edits it; append-only.** |
| `required-sources.json` | Every R-* finding, every HIGH/MEDIUM B* bug and the critics' new findings: each must be some case's `source` (or be listed as not pinnable, with the reason). |
| `ngram-ignore.json` | ClinForms' own generator wording and generic clinical phrases the third-party check does not count – each with a reason. |
| `harness/` | The runner's code (pure: the test files and scripts do the file reading). |
| `safety-corpus.test.ts` | The runner, in `test:medreport`. |
| `corpus-self.test.ts` | Shows each protection firing (lock tamper, guard, pending regression, ledger seam, n-gram, coverage, fixtures). |
| `third-party-wording.test.ts` | The env-gated wording check. |

Scripts (`scripts/medreport/corpus-*`): `corpus-run.ts` (print every result; `--suggest-pending` for the integrator),
`corpus-lock.mjs` (`--add` locks NEW cases, `--check`), `corpus-guard.mjs <base-ref>` (also checks `retired.json`),
`corpus-diff.ts` (the differential gate) and `corpus-diff.test.ts` (the gate in `test:medreport`). The differential
gate still compares every input, retired or not: retirement retires an expectation, never an input.

## A case

```json
{"id":"OPN-carrier-01","group":"OPN","title":"…","source":["R-safety-1","B2-17"],"owner":"WB","tags":["hook:notes-absence-strip"],
 "paths":["validate","sign"],"input":{"box":"prognosis","paragraph":{"text":"…","cites":["N-001"]}},"expect":"BLOCK","ack":"never"}
```

- `id` `GROUP-name-nn`; `group` one of OPN NEG COM ATT ROLE ISSUE COND TEXT EDIT REP META BAND SCALE ASAT SCOPE FILL LINT.
- `source`: the bug ids and seed references it pins. `owner`: the workstream that owns the behaviour (W0 WA1 WA2 WB WC WD WE WF).
- `paths`: where it runs – `validate`, `sign`, `render`, `store`, `reducer`, `fill`, `lint`, `assemble`, `split`, `scope`, `probe` (see `harness/types.ts` and `harness/evaluate.ts`).
- `input` (`harness/types.ts` CaseInputSchema): the report (`template:solicitor_rta`, `template:employer_ffw` or `form:<fictional form>`), the bundle and note overrides, `author`, `approver` (the voice owner; default Sarah Reid; `null` = none chosen), `signer`, `actor`, the subject `box` and `paragraph` (with `origin`, `basis`, `by`, `ownWords`), other `boxes`, structured `answers` (and `answersBy`), `gaps`, `dispositions`, reducer `steps`, and per-path input.
- `expect`: `BLOCK` | `FLAG` | `PASS` | `NOT_OFFERED` | `REFUSED_403` | `REFUSED_409` | `IDENTICAL`; `ack`: `never` | `approver` | `member` (who may acknowledge the blocking flags); `blockBy`: incidental codes that may count for this BLOCK; `check`: path-specific checks (on a validate NOT_OFFERED case, `check.flag` also requires that flag to stay on the subject).
- `negativeTwin`: required for every PASS case on an approval path (validate, sign, render, store, reducer) – a BLOCK (or refusal) case that differs only in what makes it unsafe.
- `mutate`: `strip`, `denyList {find, replace}` (required for PASS cases tagged `narrated` or `anchored`), `origin`, `actors {staff, other, approver, admin}`, `oneClick`.
- `tags`: `hook:<ledger id>` for the hook it pins.

What BLOCK, FLAG and PASS mean is in `harness/judge.ts`: a BLOCK needs a **substantive** blocking flag on the subject
(anything but citations, figures, terms, data checks, scope, open gaps, missing answers and draft-fit – unless listed in
`blockBy`), so a case never "blocks" because of a stray figure. PASS means no blocking flag of any code on the subject.

## Mutations (generated at test time, ids `<case>~<mutation>`)

- **anti-strip** over every BLOCK case with a subject paragraph: prefix "No further treatment was given. ", suffix ", as was noted.", joiner "No restrictions were recorded; ", wrapper "There were no red flags and …, as was documented.". Flags whose evidence lies only in the carrier do not count.
- **anti-deny-list** over every narrated or anchored PASS case: "needs to", "is required to", "has to", "should", "will", "must", "aims to" at the case's insertion point – each must BLOCK.
- **origin** over OPN and ATT drafted BLOCK cases: edited by the approver (BLOCK; only the approver may acknowledge); for opinion cases also written by staff through the review (BLOCK) and typed by the approver (PASS).
- **actor** for cases with `mutate.actors`: staff, a clinician who is not the approver, the approver, an administrator without may-sign.
- **one-click**: every fix offered on a validate case, applied to a copy and checked against the engine rules (`harness/fixes.ts`); on a BLOCK case a fix may only make it approvable when `check.allowFixes` lists it.

## Rules

- **Append-only.** Workstream and fix agents only ADD cases (then `node scripts/medreport/corpus-lock.mjs --add`). Never change or remove a case, a lock entry or a ledger hook: `corpus-guard.mjs <base>` refuses it, and so does the lock test.
- **Retirement** (`retired.json`, since the W0 decisions of 26/10/2026) is the only way a locked row stops counting. A
  hand-written case, a generated mutation (`<case>~<mutation>`) or a one-click variant (`<case>~fix-<kind>-<n>`) that
  cannot hold as written – it contradicts an approved design, duplicates another case with the opposite expectation,
  or pins the wrong property – stays in its file and in the lock, and gets an entry: `kind`, `lockHash` (a case) or
  `parent` + `parentLockHash` (a generated row), `retiredOn`, `decidedBy`, `decision`, `reason` and `supersededBy` (the
  hand-written case(s) that pin the intended property). The runner still runs a retired row and reports it ("retd"),
  but it counts neither as a failure nor as a hold; a retired case does not count for the ledger, the coverage check
  or as a negativeTwin. Every superseding case must exist, must not be retired and must HOLD (not pending); a retired
  row is never pending; the pinned lock hash means a retired id is never reused. `corpus-guard.mjs` refuses a removed
  (un-retired) or changed entry and an entry without its record; `corpus-self.test.ts` shows each rule firing.
- **pending.json** is the integrator's. A passing case never moves back to pending (the guard refuses it). When a workstream's fix makes a pending item hold, the run reports it as stale; the integrator removes it at the merge. `CORPUS_STRICT_PENDING=1` makes stale pending fail (release).
- **Differential gate.** Every corpus input that blocks on the production validators (`e132057`, `git archive` into `node_modules/.cache/clinforms-corpus/`) must still block, unless `allowlist.json` records Khuram's approval, or – until the owning workstream lands – `pending.json` lists it as `DIFF:<id>`. `--base-dir` accepts an existing snapshot (e.g. the read-only `bh-quality/attr/basesnap`); `--replay <dir>` adds recorded drafts (gitignored `demo-assets/bh2-replay/`).
- **Ledger.** Each hook needs at least `minBlock` (5) must-block cases tagged `hook:<id>` (BLOCK, NOT_OFFERED or REFUSED_*) and a test seam: `core/validation/registry.ts` exports `HOOK_IDS` and `withHookDisabled(id, fn)` (from `core/validation/hooks.ts`, since bh2-base); the hook's owner registers it with `defineHook(id)` in its own file and applies it only while `hookEnabled(id)`; disabling the hook must turn at least one tagged PASS case red. Until a seam exists, `LEDGER-<id>-seam` is pending with the hook's owner. A new hook goes into `ledger.json` in the same commit that adds it to the product.
- **Third-party wording.** `CLINFORMS_THIRD_PARTY_MAPS=<dir> npm run test:medreport` fails when committed corpus or fixture text shares 4+ consecutive words with a referrer's maps (`*.json`) or text dumps (`*.txt`). It prints only the shared runs. Run it before committing new cases.

## Release action names the reducer harness dispatches (contract for WA1 / WC)

`markNotApplicable {key, on}` (else `setDisposition {key, kind: "not_applicable"}`), `setDisposition {key, kind: "applies_anyway", reason}`,
`adopt {key}`, `markOwnWords {key, paragraphId}`, `acceptNoteWords {key, paragraphId}`, `takeOverApprover {}` – each with `actor`, the
acting member as the stored Actor (W0.6 `ReviewAction.actor`; it replaced bh2-r1's name and `actorIsStaff` stop-gap at bh2-base).
Provenance stamps the corpus writes (`by`, `answerBy`, `disposition.by`, `ownWords.by`, forged `accepted`/`adoptedBy`) are the same Actor;
`Report.approver` is `{memberId, name, hcpc}` and the plan's "model" is `Report.reportModel` (W0.3). An action a tree does not know leaves
the report unchanged ("UNSUPPORTED").
Release fix generators are picked up from `offeredFixes(report, {actor, form, template})` in `core/fix-types.ts` or
`ui/components/review/fixes.ts` (WD, after the W0.4 split). Each item is either `{kind, label, key, apply(report)}` or W0.6's
`FixProposal` (`core/fix-types.ts`), which the harness applies as the reducer action `applyFix {proposal}` by the acting member
(kinds the corpus names: `attribution-prefix`, `use-note-words`, `name-instead`,
`accept-note-words`, `remove-commentary`, `repeat-removal`, `value-only`, `dose-not-stated`). Since bh2-rc1 the review's
one-click actions that are not text fixes come from `offeredActions(report, {actor})` in `ui/components/review/fixes.ts`
(WB's "Accept as my note's words" through WC's reducer, "Remove the note link"), each `{kind, label, key, apply}`; the
harness reads both lists. Lint: `core/form-map-lint.ts`
`lintFormMap(form, opts) → [{rule, fieldId?, severity}]`. Tokenizer: `core/text/sentences.ts` `splitSentences(text, policy)`.
Issue state: `core/issue-state.ts` `issueState(content, form, approval)`.

## Commands

```bash
npm run test:medreport                                  # runner, self-tests, differential gate
node --import ./scripts/medreport/test-setup.mjs --import tsx scripts/medreport/corpus-run.ts --failing
node --import ./scripts/medreport/test-setup.mjs --import tsx scripts/medreport/corpus-diff.ts [--replay demo-assets/bh2-replay]
node scripts/medreport/corpus-lock.mjs --add            # lock new cases
node scripts/medreport/corpus-guard.mjs bh2-base        # at every merge
CLINFORMS_THIRD_PARTY_MAPS=<maps dir> node --import ./scripts/medreport/test-setup.mjs --import tsx --test src/modules/medreport/core/validation/__corpus__/third-party-wording.test.ts
```
