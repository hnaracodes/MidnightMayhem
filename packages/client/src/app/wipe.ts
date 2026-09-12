/**
 * 12.06 rule 4 — the iris wipe between screens. One fixed `void0` overlay whose `clip-path: circle()` closes from the
 * corners to the centre over half of `WIPE_MS`, runs the screen swap at the closed point, then opens and removes
 * itself. Under reduced motion the swap runs at once. A second wipe while one runs queues its swap after the first
 * without adding an overlay, so no transition ever stacks or traps focus (`pointer-events: none`, `aria-hidden`).
 */
import { CSS_P } from "../game/palette";

export const WIPE_MS = 350;
const ID = "iris-wipe";
/** Larger than the half-diagonal of any viewport in vw units, so the open iris clears the corners. */
const OPEN_RADIUS = "80vmax";

export function wipeDurationMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : WIPE_MS;
}

interface Running { closed: Promise<void>; done: Promise<void>; swaps: Array<() => void> }
let running: Running | null = null;

export function irisWipe(reducedMotion: boolean, swap: () => void): Promise<void> {
  if (wipeDurationMs(reducedMotion) === 0 || typeof document === "undefined") {
    swap();
    return Promise.resolve();
  }
  if (running) {
    running.swaps.push(swap);
    return running.done;
  }
  const half = WIPE_MS / 2;
  const el = document.createElement("div");
  el.id = ID;
  el.setAttribute("aria-hidden", "true");
  Object.assign(el.style, {
    position: "fixed", inset: "0", zIndex: "50", pointerEvents: "none", background: CSS_P.void0,
    clipPath: `circle(${OPEN_RADIUS} at 50% 50%)`, transition: `clip-path ${half}ms ease-in`,
  });
  document.body.append(el);
  const swaps: Array<() => void> = [swap];
  const run: Running = { swaps, closed: Promise.resolve(), done: Promise.resolve() };
  running = run;
  run.closed = new Promise<void>((resolve) => {
    // next frame so the open state is painted before the close transition starts
    requestAnimationFrame(() => {
      el.style.clipPath = "circle(0px at 50% 50%)";
      setTimeout(resolve, half);
    });
  });
  run.done = run.closed.then(() => {
    for (const fn of run.swaps.splice(0)) fn();
    el.style.transition = `clip-path ${half}ms ease-out`;
    el.style.clipPath = `circle(${OPEN_RADIUS} at 50% 50%)`;
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        el.remove();
        if (running === run) running = null;
        resolve();
      }, half);
    });
  });
  return run.done;
}
