/**
 * The Studio's live passcode (ui/passcode-check.ts): checked by the server before it is stored, a stored one
 * re-checked once per page load, and the API client's POST /passcode/check. Fictional values only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, createApiClient, retryAfterSecondsOf } from "./api-client";
import {
  classifyPasscodeCheckError,
  createPasscodeVerifier,
  isSendablePasscode,
  passcodeCheckMessage,
  type PasscodeCheckOutcome,
  type PasscodeVerifierDeps,
} from "./passcode-check";
import { WORDING } from "./wording";

const problemError = (status: number, code: string, retryAfterSeconds?: number) =>
  new ApiError({ type: "about:blank", title: code, status, code }, retryAfterSeconds === undefined ? {} : { retryAfterSeconds });

/** A fake server and tab storage: `answer(passcode)` decides each check. */
function harness(answer: (passcode: string) => Promise<void> | void, initiallyStored: string | null = null) {
  let stored: string | null = initiallyStored;
  const checked: string[] = [];
  const writes: (string | null)[] = [];
  const deps: PasscodeVerifierDeps = {
    async check(passcode) {
      checked.push(passcode);
      await answer(passcode);
    },
    getStored: () => stored,
    setStored(passcode) {
      writes.push(passcode);
      stored = passcode || null;
    },
  };
  const verifier = createPasscodeVerifier(deps);
  return {
    verifier,
    checked,
    writes,
    stored: () => stored,
    store(passcode: string | null) {
      stored = passcode;
    },
  };
}

const RIGHT = "test-only-passcode-right";
const server = (passcode: string) => {
  if (passcode !== RIGHT) throw problemError(401, "PASSCODE_INVALID");
};

test("failures are classified from the problem and Retry-After", () => {
  assert.deepEqual(classifyPasscodeCheckError(problemError(401, "PASSCODE_INVALID")), { kind: "invalid" });
  assert.deepEqual(classifyPasscodeCheckError(problemError(401, "PASSCODE_REQUIRED")), { kind: "required" });
  assert.deepEqual(classifyPasscodeCheckError(problemError(429, "RATE_LIMITED", 61)), { kind: "locked", retryAfterSeconds: 61, minutes: 2 });
  assert.deepEqual(classifyPasscodeCheckError(problemError(429, "RATE_LIMITED", 5)), { kind: "locked", retryAfterSeconds: 5, minutes: 1 });
  assert.deepEqual(classifyPasscodeCheckError(problemError(429, "RATE_LIMITED")), { kind: "locked", retryAfterSeconds: 600, minutes: 10 }, "no Retry-After: the lock-out window");
  assert.deepEqual(classifyPasscodeCheckError(problemError(503, "LIVE_AI_UNAVAILABLE")), { kind: "unavailable" });
  assert.deepEqual(classifyPasscodeCheckError(problemError(0, "NETWORK_ERROR")), { kind: "network" });
  assert.deepEqual(classifyPasscodeCheckError(problemError(401, "UNAUTHORIZED")), { kind: "error" });
  assert.deepEqual(classifyPasscodeCheckError(problemError(500, "INTERNAL")), { kind: "error" });
  assert.deepEqual(classifyPasscodeCheckError(new Error("boom")), { kind: "error" });
  assert.deepEqual(classifyPasscodeCheckError(undefined), { kind: "error" });
});

test("the dialog's messages are the neutral wording (null = accepted, the dialog closes)", () => {
  const m = (o: PasscodeCheckOutcome) => passcodeCheckMessage(o);
  assert.equal(m({ kind: "verified" }), null);
  assert.equal(m({ kind: "invalid" }), "Passcode not recognised");
  assert.equal(m({ kind: "unsupported" }), WORDING.mode.passcodeUnsupportedCharacters);
  assert.match(m({ kind: "unsupported" }) ?? "", /^Passcode not recognised – .*long dash.*Type it in/);
  assert.equal(m({ kind: "locked", retryAfterSeconds: 240, minutes: 4 }), "Too many attempts – try again in 4 minutes");
  assert.equal(m({ kind: "unavailable" }), WORDING.mode.passcodeLiveUnavailable);
  assert.equal(m({ kind: "network" }), WORDING.mode.passcodeNetworkError);
  assert.equal(m({ kind: "error" }), WORDING.mode.passcodeCheckFailed);
});

test("submit: a refused passcode is never stored; the right one is stored and verified only after the server accepts it", async () => {
  const h = harness(server);
  assert.equal(h.verifier.getState().status, "none");

  assert.deepEqual(await h.verifier.submit("wrong-guess"), { kind: "invalid" });
  assert.equal(h.stored(), null, "a wrong passcode is not stored");
  assert.deepEqual(h.writes, []);
  assert.equal(h.verifier.verifiedPasscode(), null);
  assert.equal(h.verifier.getState().status, "none");

  // Nothing typed: no request at all.
  assert.deepEqual(await h.verifier.submit("   "), { kind: "required" });
  assert.deepEqual(h.checked, ["wrong-guess"]);

  // Stored only once the check resolved (not while it is pending).
  let release!: () => void;
  const slow = harness(() => new Promise<void>((resolve) => (release = resolve)));
  const pending = slow.verifier.submit(`  ${RIGHT}  `);
  await Promise.resolve();
  assert.equal(slow.stored(), null, "nothing stored while the server checks");
  release();
  assert.deepEqual(await pending, { kind: "verified" });
  assert.equal(slow.stored(), RIGHT, "trimmed and stored after 204");
  assert.equal(slow.verifier.verifiedPasscode(), RIGHT);
  assert.equal(slow.verifier.getState().status, "verified");

  // A verified passcode survives a later wrong attempt (the wrong one is not stored over it).
  assert.deepEqual(await h.verifier.submit(RIGHT), { kind: "verified" });
  assert.deepEqual(await h.verifier.submit("another-wrong-guess"), { kind: "invalid" });
  assert.equal(h.stored(), RIGHT);
  assert.equal(h.verifier.verifiedPasscode(), RIGHT);
});

test("submit: locked out, live drafting unavailable and network errors store nothing", async () => {
  for (const [err, kind] of [
    [problemError(429, "RATE_LIMITED", 300), "locked"],
    [problemError(503, "LIVE_AI_UNAVAILABLE"), "unavailable"],
    [problemError(0, "NETWORK_ERROR"), "network"],
    [problemError(500, "INTERNAL"), "error"],
  ] as const) {
    const h = harness(() => {
      throw err;
    });
    const outcome = await h.verifier.submit(RIGHT);
    assert.equal(outcome.kind, kind);
    if (outcome.kind === "locked") assert.equal(passcodeCheckMessage(outcome), "Too many attempts – try again in 5 minutes");
    assert.equal(h.stored(), null, kind);
    assert.deepEqual(h.writes, [], kind);
    assert.equal(h.verifier.verifiedPasscode(), null, kind);
  }
});

test("page load: a stored passcode the server refuses (rotated) is cleared, with the 'rejected' notice", async () => {
  const h = harness(server, "the-old-rotated-passcode");
  assert.equal(h.verifier.getState().status, "checking", "never live before the re-check");
  assert.equal(h.verifier.verifiedPasscode(), null, "an unchecked stored passcode is not sent");
  const state = await h.verifier.recheckStored();
  assert.deepEqual(state, { status: "none", notice: "rejected" });
  assert.equal(h.stored(), null);
  assert.deepEqual(h.writes, [null]);
  h.verifier.dismissNotice();
  assert.deepEqual(h.verifier.getState(), { status: "none", notice: null });
});

test("page load: re-checked once (cached), and an accepted stored passcode becomes verified", async () => {
  const h = harness(server, RIGHT);
  const changes: string[] = [];
  h.verifier.subscribe(() => changes.push(h.verifier.getState().status));
  const [a, b] = await Promise.all([h.verifier.recheckStored(), h.verifier.recheckStored()]);
  await h.verifier.recheckStored();
  assert.deepEqual(h.checked, [RIGHT], "one request per page load");
  assert.deepEqual(a, { status: "verified", notice: null });
  assert.deepEqual(b, a);
  assert.equal(h.verifier.verifiedPasscode(), RIGHT);
  assert.deepEqual(changes, ["checking", "verified"]);

  // Nothing stored: no request.
  const empty = harness(server);
  assert.deepEqual(await empty.verifier.recheckStored(), { status: "none", notice: null });
  assert.deepEqual(empty.checked, []);
});

test("page load: a stored passcode that cannot be checked stays stored but unused (never live)", async () => {
  for (const [err, notice] of [
    [problemError(0, "NETWORK_ERROR"), "unchecked"],
    [problemError(429, "RATE_LIMITED", 120), "unchecked"],
    [problemError(500, "INTERNAL"), "unchecked"],
    [problemError(503, "LIVE_AI_UNAVAILABLE"), null],
  ] as const) {
    const h = harness(() => {
      throw err;
    }, RIGHT);
    assert.deepEqual(await h.verifier.recheckStored(), { status: "unverified", notice });
    assert.equal(h.stored(), RIGHT, "kept: it may be right");
    assert.equal(h.verifier.verifiedPasscode(), null, "but not used");
  }
});

test("a passcode entered while the page-load check runs wins; clear() forgets everything", async () => {
  let refuse!: () => void;
  const h = harness((passcode) => {
    if (passcode === "the-old-rotated-passcode") return new Promise<void>((_, reject) => (refuse = () => reject(problemError(401, "PASSCODE_INVALID"))));
    return server(passcode);
  }, "the-old-rotated-passcode");
  const recheck = h.verifier.recheckStored();
  await Promise.resolve();
  assert.deepEqual(await h.verifier.submit(RIGHT), { kind: "verified" });
  refuse();
  assert.deepEqual(await recheck, { status: "verified", notice: null }, "the old passcode's refusal does not clear the new one");
  assert.equal(h.stored(), RIGHT);

  // Something else replaces the stored passcode (not via the dialog): it is not verified.
  h.store("typed-elsewhere");
  assert.equal(h.verifier.verifiedPasscode(), null);
  assert.equal(h.verifier.getState().status, "unverified");

  h.verifier.clear();
  assert.equal(h.stored(), null);
  assert.equal(h.verifier.verifiedPasscode(), null);
  assert.deepEqual(h.verifier.getState(), { status: "none", notice: null });
});

test("api.checkPasscode: POST /passcode/check with the passcode in the header only; 204 resolves, problems reject with Retry-After", async () => {
  const seen: { url: string; method?: string; headers: Headers; body?: unknown }[] = [];
  let reply: Response = new Response(null, { status: 204 });
  const client = createApiClient({
    fetch: (async (url: string, init: RequestInit) => {
      seen.push({ url, method: init.method, headers: new Headers(init.headers), body: init.body });
      return reply;
    }) as unknown as typeof fetch,
    getSessionToken: () => "session-token-for-tests",
    getPasscode: () => "the-stored-passcode",
  });
  await client.checkPasscode(RIGHT);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "/api/reports/v1/passcode/check");
  assert.equal(seen[0].method, "POST");
  assert.equal(seen[0].headers.get("x-medreport-passcode"), RIGHT, "the passcode being checked, not the stored one");
  assert.equal(seen[0].headers.get("authorization"), "Bearer session-token-for-tests");
  assert.ok(!seen[0].url.includes(RIGHT) && !String(seen[0].body).includes(RIGHT), "never in the URL or the body");

  reply = new Response(JSON.stringify({ type: "x", title: "Too many wrong passcodes", status: 429, code: "RATE_LIMITED" }), {
    status: 429,
    headers: { "content-type": "application/problem+json", "retry-after": "187" },
  });
  const err = await client.checkPasscode("wrong-guess").then(
    () => assert.fail("should reject"),
    (e: unknown) => e,
  );
  assert.ok(err instanceof ApiError);
  assert.equal(err.status, 429);
  assert.equal(err.retryAfterSeconds, 187);
  assert.deepEqual(classifyPasscodeCheckError(err), { kind: "locked", retryAfterSeconds: 187, minutes: 4 });

  assert.equal(retryAfterSecondsOf(null), undefined);
  assert.equal(retryAfterSecondsOf(" 30 "), 30);
  assert.equal(retryAfterSecondsOf("Wed, 21 Oct 2026 07:28:00 GMT"), undefined);
});

test("a passcode with a character no header can carry (pasted long dash, curly quote, €) is 'not recognised' without a request", async () => {
  assert.equal(isSendablePasscode("test-only-passcode-right"), true);
  assert.equal(isSendablePasscode("with spaces and ~!@#$%^&*()_+{}|:<>?"), true);
  for (const odd of ["test\u2013only\u2013passcode", "\u201Cquoted\u201D-passcode", "price-\u20AC-passcode", "tab\there", "caf\u00E9-passcode"]) {
    assert.equal(isSendablePasscode(odd), false, odd);
    // The header itself would refuse it: this is what the check prevents.
    if (/[^\x00-\xFF]/.test(odd)) assert.throws(() => new Headers().set("x-medreport-passcode", odd), TypeError);
  }

  const h = harness(server);
  const outcome = await h.verifier.submit("test\u2013only\u2013passcode-right");
  assert.deepEqual(outcome, { kind: "unsupported" });
  assert.equal(passcodeCheckMessage(outcome), WORDING.mode.passcodeUnsupportedCharacters);
  assert.deepEqual(h.checked, [], "nothing sent");
  assert.equal(h.stored(), null);

  // One stored by an older Studio (which kept any passcode): refused unsent on page load, removed, notice.
  const old = harness(server, "test\u2013only\u2013passcode-right");
  assert.deepEqual(await old.verifier.recheckStored(), { status: "none", notice: "rejected" });
  assert.deepEqual(old.checked, []);
  assert.equal(old.stored(), null);
});

test("reject(): a live call refused the VERIFIED passcode → removed, demo mode, 'rejected'; any other passcode changes nothing", async () => {
  const h = harness(server);
  assert.deepEqual(await h.verifier.submit(RIGHT), { kind: "verified" });
  const changes: string[] = [];
  h.verifier.subscribe(() => changes.push(h.verifier.getState().status));

  assert.equal(h.verifier.reject("a-wrong-guess-typed-in-the-dialog"), false);
  assert.equal(h.verifier.verifiedPasscode(), RIGHT, "a refused dialog guess never clears the verified passcode");
  assert.deepEqual(changes, []);

  assert.equal(h.verifier.reject(RIGHT), true);
  assert.equal(h.verifier.verifiedPasscode(), null);
  assert.deepEqual(h.verifier.getState(), { status: "none", notice: "rejected" });
  assert.equal(h.stored(), null);
  assert.deepEqual(changes, ["none"]);
  assert.equal(h.verifier.reject(RIGHT), false, "only once");

  // A stored but unverified passcode (page-load check pending) is not the client's to reject.
  const pending = harness(server, RIGHT);
  assert.equal(pending.verifier.reject(RIGHT), false);
  assert.equal(pending.stored(), RIGHT);
});

test("reconfirm(): one check before a run of live calls; refused (rotated) → removed and false; concurrent callers share it", async () => {
  // Nothing verified: false, no request.
  const none = harness(server, RIGHT);
  assert.equal(await none.verifier.reconfirm(), false);
  assert.deepEqual(none.checked, []);

  // Accepted: true; calls at the same time share one request.
  let accept = true;
  const h = harness((passcode) => {
    if (!accept || passcode !== RIGHT) throw problemError(401, "PASSCODE_INVALID");
  });
  assert.deepEqual(await h.verifier.submit(RIGHT), { kind: "verified" });
  h.checked.length = 0;
  assert.deepEqual(await Promise.all([h.verifier.reconfirm(), h.verifier.reconfirm()]), [true, true]);
  assert.deepEqual(h.checked, [RIGHT], "one request");
  assert.equal(await h.verifier.reconfirm(), true);
  assert.equal(h.checked.length, 2, "a later run checks again");

  // Rotated on the server: false, removed, notice – and from then on nothing to send.
  accept = false;
  assert.equal(await h.verifier.reconfirm(), false);
  assert.deepEqual(h.verifier.getState(), { status: "none", notice: "rejected" });
  assert.equal(h.verifier.verifiedPasscode(), null);
  assert.equal(await h.verifier.reconfirm(), false);
  assert.equal(h.checked.length, 3, "no request without a verified passcode");

  // Could not tell (network, lock-out, server error): true, kept – the live calls decide, as before. 503: false.
  for (const [err, expected] of [
    [problemError(0, "NETWORK_ERROR"), true],
    [problemError(429, "RATE_LIMITED", 60), true],
    [problemError(500, "INTERNAL"), true],
    [problemError(503, "LIVE_AI_UNAVAILABLE"), false],
  ] as const) {
    let fail = false;
    const v = harness(() => {
      if (fail) throw err;
    });
    await v.verifier.submit(RIGHT);
    fail = true;
    assert.equal(await v.verifier.reconfirm(), expected, err.code);
    assert.equal(v.verifier.verifiedPasscode(), RIGHT, `${err.code}: kept`);
  }

  // "Switch to demo mode" while the check runs: false.
  let release!: () => void;
  const slow = harness(() => new Promise<void>((resolve) => (release = resolve)));
  const first = slow.verifier.submit(RIGHT);
  release();
  await first;
  const run = slow.verifier.reconfirm();
  slow.verifier.clear();
  release();
  assert.equal(await run, false);
});
