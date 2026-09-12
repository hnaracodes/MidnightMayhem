/**
 * Error strip at the top of the page (`.banner` in index.html). `null` hides it.
 * During a match the app adds `banner--match` to #banner so the strip sits below the HUD bars.
 */
export function showBanner(text: string | null): void {
  const banner = document.getElementById("banner");
  if (!banner) throw new Error("Missing #banner");
  banner.classList.add("banner");
  banner.textContent = text ?? "";
  banner.hidden = text === null;
}

export const PAUSED_BANNER = "Paused — switch back to this tab to resume";

/**
 * Phase 6 rule 5: input pauses only while the document is hidden. Window blur is deliberately not a pause
 * (two windows on one laptop blur each other on every click); only a hidden tab stops the sender.
 */
export function pausedByVisibility(state: DocumentVisibilityState): boolean {
  return state === "hidden";
}
