import { VisionInputError, type VisionErrorCode } from "./errors";
import { CAMERA } from "./thresholds";

function errName(err: unknown): string {
  return (err as { name?: string } | null)?.name ?? "";
}

function codeFor(err: unknown): VisionErrorCode {
  const name = errName(err);
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "camera-denied";
  // Another app (Zoom, FaceTime, Photo Booth) or another browser holds the device.
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "camera-busy";
  return "no-camera";
}

const PREFERRED: MediaStreamConstraints = {
  audio: false,
  video: {
    width: { ideal: CAMERA.width },
    height: { ideal: CAMERA.height },
    frameRate: { ideal: CAMERA.fps },
    facingMode: "user",
  },
};
/** External webcams often reject the preferred constraints; any camera beats none. */
const FALLBACK: MediaStreamConstraints = { audio: false, video: true };

/** Opens the user-facing camera at 640 × 480, 30 fps and returns a playing, CSS-mirrored <video>. */
export async function openCamera(): Promise<{ video: HTMLVideoElement; stream: MediaStream }> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new VisionInputError("no-camera");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(PREFERRED);
  } catch (first) {
    const code = codeFor(first);
    if (code === "camera-denied") throw new VisionInputError(code, first);
    console.warn("[camera] preferred constraints failed, retrying with any camera", errName(first), first);
    try {
      stream = await navigator.mediaDevices.getUserMedia(FALLBACK);
    } catch (err) {
      throw new VisionInputError(codeFor(err), err);
    }
  }

  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.style.transform = "scaleX(-1)"; // mirror so the player's physical left is screen-left
  try {
    await video.play();
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    throw new VisionInputError("no-camera", err);
  }

  const settings = stream.getVideoTracks()[0]?.getSettings();
  console.log("[vision] camera track settings", settings);
  return { video, stream };
}

/**
 * Calls `cb(ts)` once per new video frame. Prefers requestVideoFrameCallback and falls back to
 * requestAnimationFrame (deduplicated by currentTime). Returns a stop function.
 */
export function frameLoop(video: HTMLVideoElement, cb: (ts: number) => void): () => void {
  let stopped = false;

  if (typeof video.requestVideoFrameCallback === "function") {
    let handle = 0;
    const tick: VideoFrameRequestCallback = (now) => {
      if (stopped) return;
      cb(now);
      handle = video.requestVideoFrameCallback(tick);
    };
    handle = video.requestVideoFrameCallback(tick);
    return () => {
      stopped = true;
      video.cancelVideoFrameCallback(handle);
    };
  }

  let handle = 0;
  let lastTime = -1;
  const tick: FrameRequestCallback = (now) => {
    if (stopped) return;
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      cb(now);
    }
    handle = requestAnimationFrame(tick);
  };
  handle = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(handle);
  };
}
