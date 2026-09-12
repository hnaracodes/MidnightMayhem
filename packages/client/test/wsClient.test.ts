import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PING_INTERVAL_MS, RTT_EMA_WINDOW, WsClient, defaultUrl, smoothRtt } from "../src/net/wsClient";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  send(data: string): void {
    this.sent.push(data);
  }
}

describe("WsClient", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("retries with a fresh socket after a failed connect (server started after the tab)", async () => {
    const client = new WsClient();
    const first = client.connect("wss://example.test/ws");
    FakeWebSocket.instances[0]!.onerror?.();
    FakeWebSocket.instances[0]!.onclose?.();
    await expect(first).rejects.toThrow();
    expect(client.status).toBe("closed");

    const second = client.connect("wss://example.test/ws");
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1]!.open();
    await second;
    expect(client.status).toBe("open");
    client.send({ type: "READY", ready: true });
    expect(FakeWebSocket.instances[1]!.sent).toHaveLength(1);
  });

  it("dispatches messages by type to every subscribed handler", async () => {
    const client = new WsClient();
    const first = vi.fn();
    const second = vi.fn();
    client.on("WELCOME", first);
    client.on("WELCOME", second);

    const connected = client.connect("wss://example.test/ws");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    await connected;
    socket.receive({ type: "WELCOME", roomId: "ABCD", playerIndex: 0, protocolVersion: 1 });

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(client.status).toBe("open");
  });

  it("stops dispatching after unsubscribe", async () => {
    const client = new WsClient();
    const handler = vi.fn();
    const unsubscribe = client.on("OPPONENT_LEFT", handler);
    const connected = client.connect("wss://example.test/ws");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    await connected;

    unsubscribe();
    socket.receive({ type: "OPPONENT_LEFT" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores sends until the socket is open", async () => {
    const client = new WsClient();
    client.send({ type: "READY", ready: true });
    const connected = client.connect("wss://example.test/ws");
    const socket = FakeWebSocket.instances[0]!;
    client.send({ type: "READY", ready: true });
    expect(socket.sent).toEqual([]);

    socket.open();
    await connected;
    client.send({ type: "READY", ready: true });
    expect(socket.sent).toEqual([JSON.stringify({ type: "READY", ready: true })]);
  });
});

describe("smoothRtt", () => {
  it("seeds with the first sample and then averages over a window of 4", () => {
    expect(RTT_EMA_WINDOW).toBe(4);
    expect(smoothRtt(null, 40)).toBe(40);
    expect(smoothRtt(40, 80)).toBe(50); // 40 + (80 - 40) / 4
    expect(smoothRtt(50, 50)).toBe(50);
    expect(smoothRtt(50, 10)).toBe(40);
  });

  it("converges on a steady value", () => {
    let rtt: number | null = null;
    for (let k = 0; k < 40; k += 1) rtt = smoothRtt(rtt, 25);
    expect(rtt).toBeCloseTo(25, 6);
  });
});

describe("WsClient ping loop", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends PING every 2 s while open, reports the smoothed rtt from PONG and stops on close", async () => {
    const client = new WsClient();
    const rtts: number[] = [];
    let clock = 1000;
    const stop = client.startPing((rtt) => rtts.push(rtt), () => clock);
    expect(PING_INTERVAL_MS).toBe(2000);

    const connected = client.connect("wss://example.test/ws");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    await connected;
    expect(socket.sent).toEqual([JSON.stringify({ type: "PING", t: 1000 })]); // first ping on open

    clock = 1030;
    socket.receive({ type: "PONG", t: 1000, serverTime: 0 });
    expect(rtts).toEqual([30]);

    clock = 3000;
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(socket.sent).toHaveLength(2);
    expect(JSON.parse(socket.sent[1]!)).toEqual({ type: "PING", t: 3000 });
    clock = 3070;
    socket.receive({ type: "PONG", t: 3000, serverTime: 0 });
    expect(rtts).toEqual([30, 40]); // 30 + (70 - 30) / 4

    socket.onclose?.();
    vi.advanceTimersByTime(PING_INTERVAL_MS * 3);
    expect(socket.sent).toHaveLength(2);

    stop();
    socket.receive({ type: "PONG", t: 3000, serverTime: 0 });
    expect(rtts).toHaveLength(2);
  });

  it("does not send anything until startPing is called", async () => {
    const client = new WsClient();
    const connected = client.connect("wss://example.test/ws");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    await connected;
    vi.advanceTimersByTime(PING_INTERVAL_MS * 3);
    expect(socket.sent).toEqual([]);
  });
});

describe("defaultUrl", () => {
  it("uses same-origin secure WebSockets on HTTPS pages", () => {
    vi.stubGlobal("location", { protocol: "https:", host: "game.local:5173" });
    expect(defaultUrl()).toBe("wss://game.local:5173/ws");
    vi.unstubAllGlobals();
  });
});
