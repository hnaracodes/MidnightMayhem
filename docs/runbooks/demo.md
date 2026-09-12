# Demo runbook

Two laptops on one Wi-Fi. The **host** laptop runs the server and one player; the **guest** laptop opens the
host's LAN URL. Every command runs from the repo root. Keyboard always works; the camera is additive.

## Build

Once per laptop that will run a camera (downloads the pose model into `packages/client/public/models/`):

```bash
pnpm install
pnpm --filter @midnight/client vision:setup
pnpm build
```

`pnpm build` produces `packages/client/dist` (`shared` is consumed as source; the server runs from source with `tsx`).

## Cert

Browsers only expose the webcam in a secure context. `localhost` counts; a LAN IP over plain `http` does not,
so the guest laptop needs the server on `https`. Generate a self-signed cert on the host (valid 30 days):

```bash
pnpm --filter @midnight/server cert            # picks up en0's IP on macOS
pnpm --filter @midnight/server cert 10.0.0.12  # or pass the host's LAN IP explicitly
```

Writes `packages/server/certs/key.pem` and `cert.pem`. Re-run after switching networks so the SAN matches.
Without certs the server falls back to `http` and warns: `Camera requires a secure context on LAN.`

## Start server

```bash
pnpm --filter @midnight/server start      # serves packages/client/dist + /ws on one port
PORT=9000 pnpm --filter @midnight/server start   # PORT defaults to 8080
```

It prints `https://localhost:8080` followed by one `https://<LAN IP>:8080` line per interface. Copy the LAN
line. `pnpm dev:server` is the same server with reload; pair it with `pnpm dev:client` (Vite on
`https://<host>:5173`, proxies `/ws` to the server) only when you are editing code.

## LAN URL

On the guest laptop open `https://<LAN IP>:8080` in Chrome. It shows "Your connection is not private":
click **Advanced**, then **Proceed to <IP> (unsafe)**. Do this once per laptop before the judges arrive.
If the page loads but the camera button reports no camera, the URL is `http`, not `https`.

## Join flow

1. Host: type a name, leave the room code blank, click **Join**. A room code appears at the top.
2. Guest: type a name, type that room code, click **Join** (or press Enter in the code field).
3. Whoever uses the webcam clicks **Enable camera**. The button reads **Starting camera…**, then a
   full-screen prompt says `Stand still, arms at your sides` with a progress bar and a mirrored preview
   with your skeleton. Hold still about 1.5 s; the bar fills and the prompt disappears.
4. The camera button now reads **Camera on** (disabled). Both players click **Ready**. The countdown starts.
5. During the match the overlay shrinks to a compact top-left box: hidden while tracking is good, showing
   `Tracking lost — step back into view` plus the preview when you leave frame, and a **Recalibrate**
   button while it is visible. Losing tracking idles your fighter; stepping back in recalibrates.

## `?input=` flags

| URL | Effect |
|---|---|
| `/?input=keyboard` | Camera button never shown. Pure keyboard. |
| `/?input=vision` | Auto-clicks **Enable camera** as soon as the room renders. |
| `/` (or any other value) | Button shown; the player decides. |

## `?debug=1`

Draws each fighter's hurtbox (moon) and active punch hitbox (red) and a text line:
`tick N  age N ms  clock -N ms  update N ms  rtt n/a  PHASE`. `age` is the ms since the newest snapshot,
`clock` the render clock's lag behind it. The client does not send `PING` yet, so `rtt` reads `n/a`; use
`age` as the latency proxy. `window.__mm` exposes `session`, `latest()`, `sender` and `calibration()`.

## Keyboard map

| Key | Input |
|---|---|
| A / D | walk left / right |
| W | jump |
| S | block |
| F / G | punch left / right |

Keys clear on window blur. Clicking away from the window shows `Paused — click to resume`; click back.

## If the camera fails

The red banner at the top names the cause. Keyboard keeps working in every case; Ready is never blocked.

| Banner starts with | Do |
|---|---|
| `Camera permission was denied.` | Click the camera icon in the address bar, allow, click **Enable camera** again. |
| `No usable camera was found.` | Also fires when the URL is `http` on a LAN IP. Check `https`, close other apps holding the webcam (Zoom, Photo Booth), retry. |
| `The pose model failed to load` | Run `pnpm --filter @midnight/client vision:setup` on that laptop, `pnpm build`, restart the server. |
| `The camera tracker crashed before it was ready.` | Reload the page and retry once. If it repeats, play that seat on keyboard. |

Say to the judges: "Tracking dropped, switching this player to keyboard" and keep playing. If tracking
is merely wrong mid-match (wrong lean, drifting), click **Recalibrate** in the top-left box and stand still.

## If Wi-Fi fails

First fallback: a phone hotspot. Join both laptops to it, re-run the cert with the host's new IP, restart the
server and use the new LAN URL:

```bash
pnpm --filter @midnight/server cert
pnpm --filter @midnight/server start
```

Last resort: both players on the host laptop in two browser windows. `localhost` is a secure context, so no
cert or LAN URL is needed. Window 1: `http://localhost:8080/?input=vision` (webcam). Window 2:
`http://localhost:8080/?input=keyboard`. Join the same room code, Ready in both. Known limit: the client
pauses its input sender whenever its window loses focus (`Paused — click to resume`), so only the focused
window's fighter moves. Keep the keyboard window focused and treat the webcam window as a live tracking
demo, or alternate focus between exchanges. Keep both windows visible; a hidden tab pauses too.

## Rehearsal log

Three full two-laptop matches, no code changes between runs. Pose FPS, inference ms and dropped frames come
from the harness panel (`/harness.html`) on the camera laptop before the run; misfires are counted by the
camera player; latency is the `age` value from `?debug=1` (RTT once `PING` is wired).

| Run | Light / network | Pose FPS | Inference ms | Dropped frames | Misfires | Latency (age ms / RTT) | Result |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |

Fix only crashes and blocking misfires; tune numbers in `packages/client/src/vision/thresholds.ts` only.
After three consecutive clean runs and one keyboard-only match, freeze:

```bash
git tag demo-freeze
```

No merges after the tag. Pre-open both laptops on the room screen before the judges arrive.
