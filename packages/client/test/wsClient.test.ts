import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WsClient, defaultUrl } from "../src/net/wsClient";

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

describe("defaultUrl", () => {
  it("uses same-origin secure WebSockets on HTTPS pages", () => {
    vi.stubGlobal("location", { protocol: "https:", host: "game.local:5173" });
    expect(defaultUrl()).toBe("wss://game.local:5173/ws");
    vi.unstubAllGlobals();
  });
});
