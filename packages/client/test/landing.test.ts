// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHARACTERS } from "@midnight/shared";
import { Landing } from "../src/app/landing";
import { session } from "../src/game/session";

function mount(): void {
  document.body.innerHTML = '<div id="game"></div><div id="landing" class="overlay" hidden></div>';
  localStorage.clear();
  session.attract = null;
}

describe("Landing", () => {
  beforeEach(mount);

  it("renders the form: name, room code, one primary action and the full key legend", () => {
    const landing = new Landing({ onEnter: vi.fn() });
    landing.render();
    const root = document.getElementById("landing")!;
    expect(root.hidden).toBe(false);
    expect(root.querySelector("input[name=name]")).not.toBeNull();
    expect(root.querySelector("input[name=room]")).not.toBeNull();
    const primary = root.querySelector<HTMLButtonElement>("button.btn-primary")!;
    expect(primary.textContent).toBe("Board the train");
    const legend = root.querySelector(".legend")!.textContent ?? "";
    for (const key of ["A/D", "W", "S", "F/G", "Q", "1–5", "V", "M"]) expect(legend).toContain(key);
  });

  it("hands onEnter the trimmed name and the upper-cased room code", () => {
    const onEnter = vi.fn();
    const landing = new Landing({ onEnter });
    landing.render();
    const root = document.getElementById("landing")!;
    root.querySelector<HTMLInputElement>("input[name=name]")!.value = "  Ana  ";
    root.querySelector<HTMLInputElement>("input[name=room]")!.value = " k7qx ";
    root.querySelector<HTMLButtonElement>("button.btn-primary")!.click();
    expect(onEnter).toHaveBeenCalledWith("Ana", "K7QX");
  });

  it("passes no room code when the field is blank and refuses an empty name", () => {
    const onEnter = vi.fn();
    const landing = new Landing({ onEnter });
    landing.render();
    const root = document.getElementById("landing")!;
    const primary = root.querySelector<HTMLButtonElement>("button.btn-primary")!;
    primary.click();
    expect(onEnter).not.toHaveBeenCalled();
    root.querySelector<HTMLInputElement>("input[name=name]")!.value = "Ana";
    primary.click();
    expect(onEnter).toHaveBeenCalledWith("Ana", undefined);
  });

  it("reads prefers-reduced-motion into session.reducedMotion on render", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query })) as typeof window.matchMedia;
    try {
      session.reducedMotion = false;
      new Landing({ onEnter: vi.fn() }).render();
      expect(session.reducedMotion).toBe(true);
    } finally {
      window.matchMedia = original;
    }
  });

  it("sets session.attract to the four characters on render and clears it on hide", () => {
    const landing = new Landing({ onEnter: vi.fn() });
    expect(session.attract).toBeNull();
    landing.render();
    expect(session.attract).toEqual(CHARACTERS);
    landing.hide();
    expect(session.attract).toBeNull();
    expect(document.getElementById("landing")!.hidden).toBe(true);
  });
});
