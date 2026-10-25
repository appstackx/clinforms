/** admin:set-package argument handling (25/10/2026). The operation itself is tested in src/server/usage. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { CliError, parseArgs } from "./cli";
import { describePackage, packageCommand } from "./set-package";

const args = (line: string) => parseArgs(line.split(" ").filter(Boolean));

test("set-package: a preset fills in the price list; custom needs every amount; one command only", () => {
  const practice = packageCommand(args("--slug riverside --package practice"));
  assert.deepEqual(practice, {
    kind: "set",
    input: {
      package: "practice",
      monthlyPricePence: 19900,
      reportsIncluded: 100,
      extraReportPence: 150,
      foundingPricePence: null,
      foundingUntil: null,
      setupFeePence: null,
      setupFeeStatus: null,
      startsOn: null,
      notes: null,
    },
  });
  const blueHeart = packageCommand(
    args("--slug blue-heart-clinics --package custom --price 300 --reports 500 --extra 1.50 --setup-fee 250 --setup-status waived --starts 2026-11-01"),
  );
  assert.ok(blueHeart.kind === "set");
  assert.equal(blueHeart.input.monthlyPricePence, 30000);
  assert.equal(blueHeart.input.reportsIncluded, 500);
  assert.equal(blueHeart.input.extraReportPence, 150);
  assert.equal(blueHeart.input.setupFeePence, 25000);
  assert.equal(blueHeart.input.setupFeeStatus, "waived");
  assert.equal(blueHeart.input.startsOn, "2026-11-01");
  const founding = packageCommand(args("--slug x --package practice --founding-price 149"));
  assert.ok(founding.kind === "set" && founding.input.foundingPricePence === 14900 && founding.input.monthlyPricePence === 19900);
  assert.deepEqual(packageCommand(args("--slug x --show")), { kind: "show" });
  assert.deepEqual(packageCommand(args("--slug x --remove")), { kind: "remove" });
  for (const bad of [
    "--slug x",
    "--slug x --package practice --remove",
    "--slug x --package gold",
    "--slug x --package custom --price 300",
    "--slug x --package practice --price -1",
    "--slug x --package practice --extra 1.555",
    "--slug x --package practice --reports 1.5",
    "--slug x --package practice --setup-status later",
  ]) {
    assert.throws(() => packageCommand(args(bad)), CliError, bad);
  }
});

test("describePackage prints the package in plain words", () => {
  assert.deepEqual(describePackage(null), ["  no package"]);
  const lines = describePackage({
    package: "group",
    monthlyPricePence: 34900,
    reportsIncluded: 250,
    extraReportPence: 125,
    foundingPricePence: null,
    setupFeePence: 25000,
    setupFeeStatus: "paid",
    startsOn: "2026-11-01",
  });
  assert.ok(lines.includes("  package:          Group"));
  assert.ok(lines.includes("  price:            £349 a month (ex VAT)"));
  assert.ok(lines.includes("  extra report:     £1.25 each"));
  assert.ok(lines.includes("  set-up fee:       £250 (paid)"));
});
