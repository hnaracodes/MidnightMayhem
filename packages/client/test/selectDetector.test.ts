import { describe, expect, it } from "vitest";
import { selectDetector } from "../src/vision/selectDetector";
import { DETECTOR_DEFAULT } from "../src/vision/thresholds";

describe("selectDetector", () => {
  it("defaults to DETECTOR_DEFAULT without the param", () => {
    expect(selectDetector("")).toBe(DETECTOR_DEFAULT);
    expect(selectDetector("?input=vision")).toBe(DETECTOR_DEFAULT);
  });

  it("picks yolo or mediapipe from ?detector=", () => {
    expect(selectDetector("?detector=yolo")).toBe("yolo");
    expect(selectDetector("?detector=mediapipe&debug=1")).toBe("mediapipe");
  });

  it("treats unknown values as the default", () => {
    expect(selectDetector("?detector=banana")).toBe(DETECTOR_DEFAULT);
  });
});
