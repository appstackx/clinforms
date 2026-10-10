import assert from "node:assert/strict";
import { test } from "node:test";
import { scrollFadeMask } from "./scroll-fade";

test("scrollFadeMask: fades only the edge that has more to show (fix wave 2: the phone navigation)", () => {
  assert.equal(scrollFadeMask(false, false), undefined, "nothing hidden: no mask");
  assert.equal(scrollFadeMask(false, true), "linear-gradient(to right, #000 0, #000 calc(100% - 28px), transparent 100%)");
  assert.equal(scrollFadeMask(true, false), "linear-gradient(to right, transparent 0, #000 28px, #000 100%)");
  assert.equal(scrollFadeMask(true, true, 10), "linear-gradient(to right, transparent 0, #000 10px, #000 calc(100% - 10px), transparent 100%)");
});
