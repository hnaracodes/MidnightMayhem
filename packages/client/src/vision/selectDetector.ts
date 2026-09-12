/**
 * `?detector=` selector (9.07): `yolo` or `mediapipe` picks the object-detection backend the worker loads;
 * anything else (including no param) is DETECTOR_DEFAULT, which the benchmark verdict sets.
 */
import { DETECTOR_IDS, type DetectorId } from "./backends/ObjectBackend";
import { DETECTOR_DEFAULT } from "./thresholds";

export function selectDetector(search: string = location.search): DetectorId {
  const value = new URLSearchParams(search).get("detector");
  return (DETECTOR_IDS as readonly string[]).includes(value ?? "") ? (value as DetectorId) : DETECTOR_DEFAULT;
}
