// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, type MatchConfig } from "@midnight/shared";
import { CONFIG_DEBOUNCE_MS, Customize, HostControls, describeConfig } from "../src/app/setup";

function root(): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
}

function segment(el: HTMLElement, field: string, value: string): HTMLButtonElement {
  const button = el.querySelector<HTMLButtonElement>(`[data-field="${field}"] button[data-value="${value}"]`);
  if (!button) throw new Error(`no ${field}=${value}`);
  return button;
}

describe("HostControls", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

  it("disables teams unless players is 4", () => {
    const controls = new HostControls(vi.fn());
    const el = root();
    controls.render(el, DEFAULT_CONFIG, true);
    expect(segment(el, "teams", "2v2").disabled).toBe(true);
    expect(segment(el, "teams", "ffa").disabled).toBe(true);
    controls.render(el, { ...DEFAULT_CONFIG, players: 4 }, true);
    expect(segment(el, "teams", "2v2").disabled).toBe(false);
  });

  it("disables player counts below minPlayers (the seats the server would refuse to drop)", () => {
    const controls = new HostControls(vi.fn());
    const el = root();
    controls.render(el, { ...DEFAULT_CONFIG, players: 4 }, true, 3);
    expect(segment(el, "players", "2").disabled).toBe(true);
    expect(segment(el, "players", "3").disabled).toBe(false);
    expect(segment(el, "players", "4").disabled).toBe(false);
  });

  it("emits one normalised config per burst of changes, after the debounce", () => {
    const onChange = vi.fn<(config: MatchConfig) => void>();
    const controls = new HostControls(onChange);
    const el = root();
    controls.render(el, { ...DEFAULT_CONFIG, players: 4, teams: "2v2" }, true);
    segment(el, "map", "chaos").click();
    segment(el, "players", "3").click(); // 2v2 with three players is coerced to ffa
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CONFIG_DEBOUNCE_MS);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ players: 3, teams: "ffa", mode: "rounds", map: "chaos", items: true });
  });

  it("keeps a pending pick when a stale LOBBY re-renders inside the debounce window", () => {
    const onChange = vi.fn<(config: MatchConfig) => void>();
    const controls = new HostControls(onChange);
    const el = root();
    controls.render(el, DEFAULT_CONFIG, true);
    segment(el, "map", "chaos").click();
    // Another player readies up: the server echoes the old config before the host's CONFIG has even been sent.
    controls.render(el, DEFAULT_CONFIG, true);
    expect(segment(el, "map", "chaos").getAttribute("aria-pressed")).toBe("true");
    vi.advanceTimersByTime(CONFIG_DEBOUNCE_MS);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_CONFIG, map: "chaos" });
    // Once sent, the next LOBBY is the truth again.
    controls.render(el, { ...DEFAULT_CONFIG, map: "gaps" }, true);
    expect(segment(el, "map", "gaps").getAttribute("aria-pressed")).toBe("true");
  });

  it("is read-only for guests: every control disabled, current values still marked", () => {
    const onChange = vi.fn();
    const controls = new HostControls(onChange);
    const el = root();
    controls.render(el, { ...DEFAULT_CONFIG, map: "gaps" }, false);
    const buttons = [...el.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(segment(el, "map", "gaps").getAttribute("aria-pressed")).toBe("true");
    segment(el, "map", "roof").click();
    vi.advanceTimersByTime(CONFIG_DEBOUNCE_MS);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Customize", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("keeps exactly two items selected: a third pick replaces the older one and emits", () => {
    const onChange = vi.fn();
    const customize = new Customize(onChange);
    const el = root();
    customize.render(el, { character: "drifter", loadout: ["molotov", "shield"] }, []);
    expect(onChange).not.toHaveBeenCalled();
    const selected = (): string[] => [...el.querySelectorAll<HTMLElement>(".item[aria-pressed=true]")].map((t) => t.dataset["item"]!);
    expect(selected()).toEqual(["molotov", "shield"]);
    el.querySelector<HTMLButtonElement>('.item[data-item="banana"]')!.click();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("drifter", ["shield", "banana"]);
    expect(selected().sort()).toEqual(["banana", "shield"]);
    // Clicking an already selected item changes nothing and emits nothing.
    el.querySelector<HTMLButtonElement>('.item[data-item="shield"]')!.click();
    expect(onChange).toHaveBeenCalledTimes(1);
    el.querySelector<HTMLButtonElement>('.item[data-item="sword"]')!.click();
    expect(onChange).toHaveBeenLastCalledWith("drifter", ["banana", "sword"]);
  });

  it("emits the character pick with the current loadout and tags taken characters", () => {
    const onChange = vi.fn();
    const customize = new Customize(onChange);
    const el = root();
    customize.render(el, { character: "drifter", loadout: ["molotov", "shield"] }, ["conductor"]);
    const conductor = el.querySelector<HTMLButtonElement>('.portrait[data-character="conductor"]')!;
    expect(conductor.disabled).toBe(false); // duplicates are allowed
    expect(conductor.textContent).toMatch(/also/);
    conductor.click();
    expect(onChange).toHaveBeenCalledWith("conductor", ["molotov", "shield"]);
  });

  it("shows each item's uses as pips and names the real-world object", () => {
    const el = root();
    new Customize(vi.fn()).render(el, { character: "stoker", loadout: ["banana", "flash"] }, []);
    const molotov = el.querySelector<HTMLElement>('.item[data-item="molotov"]')!;
    expect(molotov.querySelectorAll(".pip").length).toBe(2);
    const sword = el.querySelector<HTMLElement>('.item[data-item="sword"]')!;
    expect(sword.querySelectorAll(".pip").length).toBe(0);
    expect(sword.querySelector(".pips")!.textContent).toBe("10s");
    expect(sword.textContent).toMatch(/racket/i);
    expect(sword.textContent).toMatch(/bring/i);
  });
});

describe("describeConfig", () => {
  it("reads as one plain sentence", () => {
    expect(describeConfig({ players: 4, teams: "2v2", mode: "rounds", map: "chaos", items: true }))
      .toBe("4 players, 2v2, best of 3 on Chaos, items on");
    expect(describeConfig(DEFAULT_CONFIG)).toBe("2 players, free-for-all, best of 3 on Roof, items on");
    expect(describeConfig({ players: 3, teams: "ffa", mode: "timed", map: "gaps", items: false }))
      .toBe("3 players, free-for-all, one 90 s round on Gaps, items off");
    expect(describeConfig({ players: 2, teams: "ffa", mode: "deathmatch", map: "platforms", items: true }))
      .toBe("2 players, free-for-all, deathmatch on Platforms, items on");
  });
});
