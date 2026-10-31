/**
 * M10 L7: how long a public answer takes – at least `minMs`; a slower one (the D1 worst case) is rounded UP to the next
 * whole second, so a request that did more work (a matched patient) still lands in the same step as one that did
 * less. Pure.
 */
export function paddedMs(minMs: number, elapsedMs: number): number {
  return elapsedMs <= minMs ? minMs : Math.ceil(elapsedMs / 1000) * 1000;
}
