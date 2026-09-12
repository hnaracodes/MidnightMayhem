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
