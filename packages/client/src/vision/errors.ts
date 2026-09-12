/** Failure modes of the vision layer, surfaced to the shell as a banner. */
export type VisionErrorCode = "camera-denied" | "camera-busy" | "no-camera" | "model-load" | "worker-failed";

export class VisionInputError extends Error {
  readonly code: VisionErrorCode;
  constructor(code: VisionErrorCode, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "VisionInputError";
    this.code = code;
  }
}
