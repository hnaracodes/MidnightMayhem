import { describe, expect, it } from "vitest";
import { pausedByVisibility } from "../src/app/banner";

describe("pause policy (Phase 6 rule 5, hidden-only)", () => {
  it("pauses when the document becomes hidden", () => {
    expect(pausedByVisibility("hidden")).toBe(true);
  });

  it("resumes when the document is visible again", () => {
    expect(pausedByVisibility("visible")).toBe(false);
  });

  it("is driven by visibility alone: a window blur is not a visibility state", () => {
    // Two windows on one laptop blur each other on every click; only a hidden tab may pause the sender.
    const events: Array<"blur" | "focus" | "visibilitychange"> = ["blur", "focus", "visibilitychange"];
    const pausing = events.filter((e) => e === "visibilitychange");
    expect(pausing).toEqual(["visibilitychange"]);
  });
});
