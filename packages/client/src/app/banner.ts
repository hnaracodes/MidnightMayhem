export function showBanner(text: string | null): void {
  const banner = document.getElementById("banner");
  if (!banner) throw new Error("Missing #banner");
  banner.textContent = text ?? "";
  banner.hidden = text === null;
}
