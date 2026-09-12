// Live smoke for 10.03: four sockets HELLO into one room, the host sets players: 4, everyone READYs, and we wait
// for snapshots carrying four fighters. Not a vitest. Run with a server up:
//   PORT=8090 pnpm --filter @midnight/server dev      (terminal 1)
//   node packages/server/test/smoke.mjs 8090           (terminal 2)
// Exits 0 on success, 1 on failure or a 10 s timeout. Uses ws:// unless the server reports https (then wss://,
// with self-signed certificates accepted).
import { WebSocket } from "ws";

const port = Number(process.argv[2] ?? process.env.PORT ?? 8080);
const scheme = process.env.MM_TLS ? "wss" : "ws";
const url = `${scheme}://localhost:${port}/ws`;
const roomId = "SMOKE";
const N = 4;
const config = { players: 4, teams: "2v2", mode: "rounds", map: "roof", items: true };

const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const fail = (why) => { log("FAIL:", why); process.exit(1); };
const timer = setTimeout(() => fail("timeout after 10 s"), 10_000);

const sockets = [];
const snapshots = new Array(N).fill(0);
let fourFighterSnapshots = 0;
let started = false;

function open(i) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { rejectUnauthorized: false });
    sockets[i] = ws;
    ws.on("error", (e) => reject(e));
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "HELLO", name: `P${i}`, roomId }));
    });
    ws.on("message", (data) => {
      const m = JSON.parse(data.toString());
      if (m.type === "WELCOME") {
        if (m.playerIndex !== i) fail(`P${i} got slot ${m.playerIndex}`);
        log(`P${i} welcomed into ${m.roomId} as slot ${m.playerIndex} (protocol ${m.protocolVersion})`);
        resolve();
      } else if (m.type === "ERROR") {
        fail(`P${i} ERROR ${m.code}: ${m.message}`);
      } else if (m.type === "LOBBY") {
        if (i === 0) log(`LOBBY host=${m.host} players=${m.config.players} seated=${m.players.filter(Boolean).length} ready=${m.players.filter((p) => p?.ready).length}`);
      } else if (m.type === "SNAPSHOT") {
        snapshots[i]++;
        if (m.state.fighters.length === 4) fourFighterSnapshots++;
        else fail(`snapshot with ${m.state.fighters.length} fighters`);
        if (m.ackSeq !== 0 && i === 0) fail(`ackSeq ${m.ackSeq} but no input was sent`);
        if (!started && snapshots.every((n) => n >= 5)) {
          started = true;
          log(`every slot has >= 5 snapshots; fighters=${m.state.fighters.map((f) => f.character).join(",")} teams=${m.state.fighters.map((f) => f.team).join(",")} phase=${m.state.phase} tick=${m.state.tick}`);
          log("PASS");
          clearTimeout(timer);
          for (const s of sockets) s.close();
          process.exit(0);
        }
      }
    });
  });
}

const send = (i, m) => sockets[i].send(JSON.stringify(m));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await open(0);
  send(0, { type: "CONFIG", config });
  await wait(50);
  await open(1); await open(2); await open(3);
  await wait(50);
  for (let i = 0; i < N; i++) send(i, { type: "READY", ready: true });
  log("all READY sent; waiting for snapshots");
} catch (e) {
  fail(`connect to ${url}: ${e.message}`);
}
