import type { ClientMessage, ServerMessage } from "@midnight/shared";

export type Status = "idle" | "connecting" | "open" | "closed";

type MessageType = ServerMessage["type"];
type MessageOfType<T extends MessageType> = Extract<ServerMessage, { type: T }>;
type MessageHandler = (message: ServerMessage) => void;

/** Debug RTT probe: one PING every 2 s, smoothed over the last 4 replies. Only runs when the app starts it. */
export const PING_INTERVAL_MS = 2000;
export const RTT_EMA_WINDOW = 4;

/** Exponential moving average over `RTT_EMA_WINDOW` samples; the first sample seeds it. Pure. */
export function smoothRtt(prev: number | null, sampleMs: number): number {
  return prev === null ? sampleMs : prev + (sampleMs - prev) / RTT_EMA_WINDOW;
}

export function defaultUrl(): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}

export class WsClient {
  status: Status = "idle";
  onStatus: (status: Status) => void = () => undefined;

  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly handlers = new Map<MessageType, Set<MessageHandler>>();
  private ping: { timer: ReturnType<typeof setInterval> | null; send: () => void; stop: () => void } | null = null;

  connect(url = defaultUrl()): Promise<void> {
    if (this.connectPromise) return this.connectPromise;

    this.setStatus("connecting");
    const socket = new WebSocket(url);
    this.socket = socket;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      let opened = false;

      socket.onopen = () => {
        opened = true;
        this.setStatus("open");
        resolve();
      };
      socket.onerror = () => {
        if (!opened) {
          this.setStatus("closed");
          reject(new Error("WebSocket connection failed"));
        }
      };
      socket.onclose = () => this.setStatus("closed");
      socket.onmessage = (event) => this.dispatch(event.data);
    });

    return this.connectPromise;
  }

  send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  on<T extends MessageType>(
    type: T,
    handler: (message: MessageOfType<T>) => void,
  ): () => void {
    let handlers = this.handlers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(type, handlers);
    }
    const broadHandler = handler as MessageHandler;
    handlers.add(broadHandler);
    return () => handlers.delete(broadHandler);
  }

  /**
   * Start the RTT probe: PING `{ t: now() }` on open and every `PING_INTERVAL_MS` while open; each PONG yields
   * `now() - t`, smoothed with `smoothRtt`, to `onRtt`. Returns a function that stops the loop. Nothing is sent
   * unless this is called, so the demo build (no `?debug=1`) never pings.
   */
  startPing(onRtt: (rttMs: number) => void, now: () => number = () => performance.now()): () => void {
    this.ping?.stop();
    let rtt: number | null = null;
    const offPong = this.on("PONG", (message) => {
      rtt = smoothRtt(rtt, now() - message.t);
      onRtt(rtt);
    });
    const send = () => this.send({ type: "PING", t: now() });
    const ping = {
      timer: null as ReturnType<typeof setInterval> | null,
      send,
      stop: () => {
        if (ping.timer !== null) clearInterval(ping.timer);
        ping.timer = null;
        offPong();
        if (this.ping === ping) this.ping = null;
      },
    };
    this.ping = ping;
    if (this.status === "open") this.pingStatus("open");
    return ping.stop;
  }

  /** Runs the probe only while the socket is open. */
  private pingStatus(status: Status): void {
    const ping = this.ping;
    if (!ping) return;
    if (status === "open") {
      if (ping.timer !== null) return;
      ping.send();
      ping.timer = setInterval(ping.send, PING_INTERVAL_MS);
    } else if (ping.timer !== null) {
      clearInterval(ping.timer);
      ping.timer = null;
    }
  }

  private dispatch(raw: unknown): void {
    try {
      const message = JSON.parse(String(raw)) as ServerMessage;
      if (!message || typeof message !== "object" || typeof message.type !== "string") return;
      this.handlers.get(message.type)?.forEach((handler) => handler(message));
    } catch (error) {
      console.error("Ignoring invalid WebSocket message", error);
    }
  }

  private setStatus(status: Status): void {
    this.status = status;
    this.pingStatus(status);
    this.onStatus(status);
  }
}
