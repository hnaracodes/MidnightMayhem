import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { WebSocket, WebSocketServer } from "ws";
import { handleClose, handleMessage, type Conn, type ServerContext } from "./handlers";
import { RoomRegistry } from "./rooms";
import { RoomLoop } from "./loop";
import { loadCerts } from "./certs";

export const PORT = Number(process.env.PORT ?? 8080);
const distDir = resolve(fileURLToPath(new URL("../../client/dist", import.meta.url)));
const mime: Record<string, string> = {
  ".js": "text/javascript", ".css": "text/css", ".html": "text/html; charset=utf-8",
  ".wasm": "application/wasm", ".task": "application/octet-stream", ".json": "application/json",
};

function headers(res: ServerResponse): void {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  headers(res);
  if (!existsSync(distDir)) {
    res.statusCode = 404;
    res.end("Client build missing. Run pnpm --filter @midnight/client build.\n");
    return;
  }
  let relative: string;
  try {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    relative = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    // A bad percent-escape (GET /%) throws URIError; an uncaught throw here would kill the whole server.
    res.statusCode = 400;
    res.end("Bad path");
    return;
  }
  const candidate = resolve(distDir, relative);
  if (!candidate.startsWith(`${distDir}/`) && candidate !== distDir) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }
  let file = candidate;
  if (!existsSync(file) || !statSync(file).isFile()) file = join(distDir, "index.html");
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }
  res.setHeader("Content-Type", mime[extname(file).toLowerCase()] ?? "application/octet-stream");
  res.statusCode = 200;
  res.end(readFileSync(file));
}

function lanUrls(port: number): string[] {
  const urls: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) urls.push(`https://${entry.address}:${port}`);
    }
  }
  return urls;
}

const context: ServerContext = { registry: new RoomRegistry(), loops: new Map<string, RoomLoop>(), now: () => performance.now() };
const certs = loadCerts();
const server = certs ? createHttpsServer(certs, serveStatic) : createHttpServer(serveStatic);
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4096 });

/** Milliseconds between liveness pings; a socket that has not answered the previous ping is terminated. */
export const HEARTBEAT_MS = 5000;

// Liveness: `ws` never notices a half-open peer (laptop asleep, Wi-Fi dropped) on its own, and the OS timeout can be
// minutes, during which the ghost keeps its slot and the room stays full. `terminate()` fires `close`, so the
// ordinary leave path (10.03 rule 8) runs unchanged.
const alive = new WeakMap<WebSocket, boolean>();
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (alive.get(socket) === false) { socket.terminate(); continue; }
    alive.set(socket, false);
    socket.ping();
  }
}, HEARTBEAT_MS);
heartbeat.unref();
wss.on("close", () => clearInterval(heartbeat));

wss.on("connection", (socket) => {
  alive.set(socket, true);
  socket.on("pong", () => alive.set(socket, true));
  const conn: Conn = {
    room: null,
    index: null,
    badFrames: 0,
    send: (message) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); },
    close: (code, reason) => socket.close(code, reason),
  };
  socket.on("message", (data, isBinary) => {
    if (isBinary) handleMessage(context, conn, data as unknown as string);
    else handleMessage(context, conn, data.toString());
  });
  socket.on("close", () => handleClose(context, conn));
  socket.on("error", () => handleClose(context, conn));
});

// One bad request or a throw inside a handler must never take every room down with it.
process.on("uncaughtException", (err) => { console.error("[server] uncaught exception", err); });
process.on("unhandledRejection", (err) => { console.error("[server] unhandled rejection", err); });

server.listen(PORT, () => {
  const scheme = certs ? "https" : "http";
  console.log(`${scheme}://localhost:${PORT}`);
  if (certs) for (const url of lanUrls(PORT)) console.log(url);
  else console.warn("Camera requires a secure context on LAN. Run pnpm --filter @midnight/server cert, then restart.");
});
