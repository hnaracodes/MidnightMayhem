/**
 * `?input=` selector (3.03, extended by Phase 6 rule 3):
 * - `keyboard`: the lobby never shows the camera button.
 * - `vision`: the lobby auto-clicks "Enable camera" once the room renders (demo runbook).
 * - anything else: `auto` — the button is shown and the player decides.
 */
export type SourceChoice = "keyboard" | "vision" | "auto";

export function selectSource(search: string = location.search): SourceChoice {
  const value = new URLSearchParams(search).get("input");
  return value === "vision" || value === "keyboard" ? value : "auto";
}
