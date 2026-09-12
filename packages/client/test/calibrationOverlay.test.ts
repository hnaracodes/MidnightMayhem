import { describe, expect, it } from "vitest";
import { LOST_PROMPT, STAND_STILL_PROMPT, overlayModel } from "../src/app/calibrationOverlay";

describe("overlayModel (lobby, full screen)", () => {
  it("shows a starting prompt before the camera reports a phase", () => {
    const m = overlayModel({ phase: "idle", progress: 0 }, "full");
    expect(m.visible).toBe(true);
    expect(m.prompt).toMatch(/camera/i);
    expect(m.preview).toBe(false);
    expect(m.recalibrate).toBe(false);
  });

  it("prompts to stand still with the live progress while calibrating", () => {
    const m = overlayModel({ phase: "calibrating", progress: 0.4 }, "full");
    expect(m.visible).toBe(true);
    expect(m.prompt).toBe(STAND_STILL_PROMPT);
    expect(m.progress).toBe(0.4);
    expect(m.preview).toBe(true);
    expect(m.recalibrate).toBe(false);
  });

  it("explains tracking loss with an empty bar", () => {
    const m = overlayModel({ phase: "lost", progress: 0.9 }, "full");
    expect(m.visible).toBe(true);
    expect(m.prompt).toBe(LOST_PROMPT);
    expect(m.progress).toBe(0);
    expect(m.preview).toBe(true);
  });

  it("hides entirely once ready", () => {
    expect(overlayModel({ phase: "ready", progress: 1 }, "full").visible).toBe(false);
  });
});

describe("overlayModel (match, compact corner)", () => {
  it("keeps the prompt and preview but adds Recalibrate while calibrating", () => {
    const m = overlayModel({ phase: "calibrating", progress: 0.2 }, "compact");
    expect(m.visible).toBe(true);
    expect(m.prompt).toBe(STAND_STILL_PROMPT);
    expect(m.progress).toBe(0.2);
    expect(m.preview).toBe(true);
    expect(m.recalibrate).toBe(true);
  });

  it("shows why the fighter stopped when tracking is lost", () => {
    const m = overlayModel({ phase: "lost", progress: 0 }, "compact");
    expect(m.visible).toBe(true);
    expect(m.prompt).toBe(LOST_PROMPT);
    expect(m.recalibrate).toBe(true);
  });

  it("collapses to just the Recalibrate button when ready", () => {
    const m = overlayModel({ phase: "ready", progress: 1 }, "compact");
    expect(m.visible).toBe(true);
    expect(m.prompt).toBeNull();
    expect(m.preview).toBe(false);
    expect(m.recalibrate).toBe(true);
  });

  it("stays hidden before the camera is up", () => {
    expect(overlayModel({ phase: "idle", progress: 0 }, "compact").visible).toBe(false);
  });
});
