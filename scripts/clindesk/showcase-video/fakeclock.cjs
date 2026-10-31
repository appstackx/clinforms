// Local video recording only: shifts this Node process's wall clock so the story day (Tue 10/11/2026) is "today".
// FAKE_NOW=<ISO instant> FAKE_SET_AT=<epoch ms when that instant was now>. Time keeps running at real speed.
const target = Date.parse(process.env.FAKE_NOW || "");
if (Number.isFinite(target)) {
  const setAt = Number(process.env.FAKE_SET_AT) || Date.now();
  const OFF = target - setAt;
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(RealDate.now() + OFF); else super(...a); }
    static now() { return RealDate.now() + OFF; }
  }
  FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse;
  globalThis.Date = FakeDate;
}
