# Phase 7 — Demo hardening

## Purpose
Make the demo survive the venue: rehearsal, fallbacks, and a runbook anyone can follow.

## Files
Create: `docs/runbooks/demo.md`. Modify only bugs found in rehearsal.

## Depends on
Phase 6.

## Exposes
- Runbook sections: build, cert, start server, LAN URL, join flow, `?input=` flags, `?debug=1`, keyboard map, "if the camera fails" script, "if Wi-Fi fails" (both players on the host laptop with two browser windows, one keyboard, one webcam).

## Behaviour
1. Rehearse the full two-laptop match three times in venue-like light and on the venue Wi-Fi (or a phone hotspot as the fallback network) without code changes between runs.
2. Record per run: pose FPS, inference ms, dropped frames, any misfires, RTT from PING/PONG shown in the debug overlay.
3. Fix only crashes and misfires that block the loop; tune thresholds in `thresholds.ts` only.
4. Freeze: tag the commit `demo-freeze`; no further merges.
5. Pre-open both laptops on the room screen before judges arrive; the host laptop runs the server.

## Invariants
- The keyboard-only path is demonstrated once during rehearsal so the fallback is proven, not assumed.

## Tests
- Owner gate: three consecutive clean matches; runbook followed by someone who did not write the code.

## Done when
- [ ] tag exists; runbook committed
