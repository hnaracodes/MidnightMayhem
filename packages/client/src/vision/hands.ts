/**
 * Reserved for the hands stretch plan (docs/superpowers/plans/2026-09-12-hands-stretch.md).
 * `undefined` means "no hand assigned", which the punch rule treats as fist-ok.
 */
export function fistFor(_arm: "L" | "R"): true | false | undefined {
  return undefined;
}
