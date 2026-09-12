import { describe, expect, it } from "vitest";
import { VisionInputError } from "../src/vision/errors";
import {
  WorkerClient,
  type WorkerInbound,
  type WorkerLike,
  type WorkerOutbound,
} from "../src/vision/workerClient";

/** A stand-in for the browser Worker: records what was posted and lets tests emit messages. */
class FakeWorker implements WorkerLike {
  posted: { msg: WorkerInbound; transfer: Transferable[] }[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<WorkerOutbound>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage(msg: WorkerInbound, transfer: Transferable[] = []): void {
    this.posted.push({ msg, transfer });
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(msg: WorkerOutbound): void {
    this.onmessage?.({ data: msg } as MessageEvent<WorkerOutbound>);
  }
  fail(message = "boom"): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

const video = {} as HTMLVideoElement;
const fakeBitmap = { close() {} } as unknown as ImageBitmap;

function setup(now = () => 0) {
  const worker = new FakeWorker();
  const client = new WorkerClient({
    createWorker: () => worker,
    createBitmap: () => Promise.resolve(fakeBitmap),
    now,
  });
  return { worker, client };
}

/** Let queued microtasks (the bitmap promise) run. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("WorkerClient.start", () => {
  it("posts init and resolves with the delegate on ready", async () => {
    const { worker, client } = setup();
    const p = client.start();
    expect(worker.posted[0]?.msg).toEqual({ type: "init" });
    worker.emit({ type: "ready", delegate: "CPU", objects: true });
    await expect(p).resolves.toEqual({ delegate: "CPU", objects: true });
    expect(client.stats.delegate).toBe("CPU");
    expect(client.stats.objects).toBe(true);
  });

  it("9.04: a worker without the detector reports objects: false and results carry objects: null", async () => {
    const { worker, client } = setup();
    const p = client.start();
    worker.emit({ type: "ready", delegate: "GPU", objects: false });
    await expect(p).resolves.toEqual({ delegate: "GPU", objects: false });
    expect(client.stats.objects).toBe(false);

    const results: WorkerOutbound[] = [];
    client.onResult((r) => results.push(r));
    for (let i = 0; i < 6; i++) {
      client.sendFrame(video, i);
      worker.emit({ type: "result", ts: i, pose: null, poseMs: 4, delegate: "GPU", objects: null, objectMs: 0 });
    }
    expect(results).toHaveLength(6);
    expect(results.every((r) => r.type === "result" && r.objects === null)).toBe(true);
    expect(client.stats.objectMs).toBe(0);
  });

  it("9.04: objectMs is kept from the last result that ran the detector", async () => {
    const { worker, client } = setup();
    const p = client.start();
    worker.emit({ type: "ready", delegate: "GPU", objects: true });
    await p;
    client.sendFrame(video, 1);
    worker.emit({ type: "result", ts: 1, pose: null, poseMs: 4, delegate: "GPU", objects: [], objectMs: 22 });
    expect(client.stats.objectMs).toBe(22);
    client.sendFrame(video, 2);
    worker.emit({ type: "result", ts: 2, pose: null, poseMs: 4, delegate: "GPU", objects: null, objectMs: 0 });
    expect(client.stats.objectMs).toBe(22);
  });

  it("rejects with worker-failed if the worker errors before ready", async () => {
    const { worker, client } = setup();
    const p = client.start();
    worker.fail();
    await expect(p).rejects.toBeInstanceOf(VisionInputError);
    await expect(p).rejects.toMatchObject({ code: "worker-failed" });
  });

  it("rejects with model-load if the worker reports a model error", async () => {
    const { worker, client } = setup();
    const p = client.start();
    worker.emit({ type: "error", code: "model-load" });
    await expect(p).rejects.toMatchObject({ code: "model-load" });
  });
});

describe("WorkerClient.sendFrame", () => {
  it("drops frames before start", () => {
    const { client } = setup();
    expect(client.sendFrame(video, 1)).toBe(false);
    expect(client.stats.dropped).toBe(1);
  });

  it("keeps at most one frame in flight and transfers the bitmap", async () => {
    const { worker, client } = setup();
    const p = client.start();
    worker.emit({ type: "ready", delegate: "GPU", objects: true });
    await p;

    expect(client.sendFrame(video, 10)).toBe(true);
    expect(client.sendFrame(video, 11)).toBe(false);
    expect(client.sendFrame(video, 12)).toBe(false);
    expect(client.stats.dropped).toBe(2);
    await flush();

    const frame = worker.posted[1];
    expect(frame?.msg).toEqual({ type: "frame", bitmap: fakeBitmap, ts: 10 });
    expect(frame?.transfer).toEqual([fakeBitmap]);
    expect(worker.posted).toHaveLength(2);

    const results: WorkerOutbound[] = [];
    client.onResult((r) => results.push(r));
    worker.emit({ type: "result", ts: 10, pose: null, poseMs: 7, delegate: "GPU", objects: null, objectMs: 0 });
    expect(results).toHaveLength(1);
    expect(client.stats.poseMs).toBe(7);

    expect(client.sendFrame(video, 13)).toBe(true);
    expect(client.stats.dropped).toBe(2);
  });

  it("counts results in the last second as fps", async () => {
    let t = 0;
    const { worker, client } = setup(() => t);
    const p = client.start();
    worker.emit({ type: "ready", delegate: "GPU", objects: true });
    await p;
    for (let i = 0; i < 5; i++) {
      t = i * 100;
      client.sendFrame(video, t);
      worker.emit({ type: "result", ts: t, pose: null, poseMs: 5, delegate: "GPU", objects: null, objectMs: 0 });
    }
    expect(client.stats.fps).toBe(5);
    t = 1350; // results at 0, 100, 200, 300 have aged out
    client.sendFrame(video, t);
    worker.emit({ type: "result", ts: t, pose: null, poseMs: 5, delegate: "GPU", objects: null, objectMs: 0 });
    expect(client.stats.fps).toBe(2);
  });

  it("frees the in-flight slot if the worker errors mid-frame", async () => {
    const { worker, client } = setup();
    const p = client.start();
    worker.emit({ type: "ready", delegate: "GPU", objects: true });
    await p;
    expect(client.sendFrame(video, 1)).toBe(true);
    worker.fail();
    expect(client.sendFrame(video, 2)).toBe(true);
  });
});

describe("WorkerClient.stop", () => {
  it("terminates the worker and drops later frames", async () => {
    const { worker, client } = setup();
    const p = client.start();
    worker.emit({ type: "ready", delegate: "GPU", objects: true });
    await p;
    client.stop();
    expect(worker.terminated).toBe(true);
    expect(client.sendFrame(video, 1)).toBe(false);
  });

  it("rejects a pending start with worker-failed", async () => {
    const { client } = setup();
    const p = client.start();
    client.stop();
    await expect(p).rejects.toMatchObject({ code: "worker-failed" });
  });
});
