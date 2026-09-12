import { VisionInputSource } from "../vision/VisionInputSource";
import { VisionInputError, type VisionErrorCode } from "../vision/errors";
import { createChecklist } from "./checklist";
import { createOverlay } from "./overlay";
import { createPanel } from "./panel";

const MESSAGES: Record<VisionErrorCode, string> = {
  "camera-denied": "Camera permission was denied. Allow the camera for this site and reload.",
  "no-camera": "No usable camera was found.",
  "model-load": "The pose model failed to load. Run `pnpm --filter @midnight/client vision:setup` and reload.",
  "worker-failed": "The vision worker crashed before it was ready.",
};

const $ = <T extends HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as T;
};

const banner = $("banner");
const wrap = $("wrap");
const canvas = $<HTMLCanvasElement>("overlay");
const prompt = $("prompt");
const promptText = $("prompt-text");
const progressBar = $("progress").firstElementChild as HTMLElement;
const calState = $("cal-state");

const source = new VisionInputSource();
const overlay = createOverlay(canvas, () => {
  const v = source.video;
  return { w: v?.videoWidth || 640, h: v?.videoHeight || 480 };
});
const panel = createPanel($("panel"));
const checklist = createChecklist($("checklist"));

let videoAttached = false;

source.onDebug((f) => {
  if (!videoAttached && source.video) {
    wrap.prepend(source.video);
    videoAttached = true;
  }
  overlay.draw(f);
  panel.update(f, source.stats());
  checklist.update(source.sample(), f.ts);

  const { phase, progress } = f.calibration;
  calState.textContent = phase === "ready" ? "ready" : phase;
  if (phase === "calibrating") {
    prompt.hidden = false;
    promptText.textContent = "Stand still, arms at your sides";
    progressBar.style.width = `${Math.round(progress * 100)}%`;
  } else if (phase === "lost") {
    prompt.hidden = false;
    promptText.textContent = "Tracking lost — step back into view";
    progressBar.style.width = "0%";
  } else {
    prompt.hidden = true;
  }
});

$("calibrate").addEventListener("click", () => {
  void source.calibrate();
});

function showError(err: unknown): void {
  const code = err instanceof VisionInputError ? err.code : "worker-failed";
  banner.textContent = `${code}: ${MESSAGES[code]}`;
  banner.toggleAttribute("data-show", true);
  prompt.hidden = true;
  console.error("[harness]", err);
}

prompt.hidden = false;
source.start().catch(showError);
