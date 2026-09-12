import { describe, expect, it } from "vitest";
import { selectSource } from "../src/input/selectSource";

describe("selectSource", () => {
  it("defaults to auto so the lobby shows the camera button", () => {
    expect(selectSource("")).toBe("auto");
    expect(selectSource("?debug=1")).toBe("auto");
  });

  it("hides the camera behind ?input=keyboard", () => {
    expect(selectSource("?input=keyboard")).toBe("keyboard");
  });

  it("auto-starts the camera behind ?input=vision", () => {
    expect(selectSource("?input=vision&debug=1")).toBe("vision");
  });

  it("treats unknown values as auto", () => {
    expect(selectSource("?input=banana")).toBe("auto");
  });
});
