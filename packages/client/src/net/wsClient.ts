import type { ClientMessage, ServerMessage } from "@midnight/shared";

export type Status = "idle" | "connecting" | "open" | "closed";

type MessageType = ServerMessage["type"];
type MessageOfType<T extends MessageType> = Extract<ServerMessage, { type: T }>;
type MessageHandler = (message: ServerMessage) => void;

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
    this.onStatus(status);
  }
}
