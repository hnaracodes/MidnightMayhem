export function selectSource(): "keyboard" | "vision" {
  return new URLSearchParams(location.search).get("input") === "vision" ? "vision" : "keyboard";
}
