> **SUPERSEDED 2026-09-12.** This document is historical. The build follows `DECISIONS_CHANGED.md` (root) and `docs/superpowers/plans/2026-09-12-midnight-express-mvp.md`. Where this file disagrees with them, they win. Kept for reference only.

# Test and Demo Checklist

## First acceptance checkpoint — integration owner

Run this every 60–90 minutes and before accepting any CV or partner merge. It must pass on two real browser instances:

- [ ] Both players join one room.
- [ ] Both choose a pre-seeded kit and complete countdown.
- [ ] Keyboard/button actions create server-confirmed damage on both screens.
- [ ] Both screens reach the same winner/draw result.

If it fails, pause optional work and restore the last known-good vertical slice.

## Required command-level checks

```bash
pnpm install
pnpm --filter @last-car-clash/shared build
pnpm --filter @last-car-clash/server test
pnpm --filter @last-car-clash/client build
pnpm --filter @last-car-clash/server dev
```

Before demo, open `http://localhost:5173` in two isolated browser profiles. Confirm every outgoing browser message is below 4096 bytes in DevTools, one `SNAPSHOT` arrives approximately every 66–67 ms, and a rejected input visibly restores its predicted local control state. For YOLO, test all five allowed objects: each must either confirm within 1.5 seconds or cleanly reach fallback/cancel without freezing controls.

## Automated combat checks

- [ ] Same-lane projectile damages once.
- [ ] Different-lane projectile misses.
- [ ] Swept projectile collision catches high-speed movement.
- [ ] Block reduces 20 damage to 6 damage.
- [ ] Dodge i-frames work only on designated ticks.
- [ ] Dodge cannot leave the three-lane arena.
- [ ] Duplicate `seq` does not create a second action.
- [ ] Cooldown prevents repeated power use.
- [ ] Scan token cannot be reused or submitted after expiry.
- [ ] Full item slots replace the oldest item deterministically.
- [ ] Timer resolves a draw when HP is equal.
- [ ] Same-tick opposing attacks can resolve as a draw.
- [ ] Room cannot start before two loadouts and two ready signals.
- [ ] Client ignores a snapshot with an older or equal version.

## Device checks

- [ ] Both devices can join the same deployed room.
- [ ] Both cameras have permission before the pitch begins.
- [ ] Pose actions work at normal standing distance.
- [ ] Bottle, book, backpack, cup, and phone have been tested in venue lighting.
- [ ] A player can finish a match using keyboard fallback only.
- [ ] Disconnect/reconnect shows a clear state.

## Live-demo runbook

1. Open the deployed URL on two devices and verify room connection.
2. Preload camera and CV models before judges arrive.
3. Player A scans a bottle; Player B scans a book.
4. Start a 45-second match.
5. Demonstrate one block, one dodge, one power, and one Baggage Scan.
6. Call out Tunnel and Final Car when they trigger.
7. Let the server announce the winner.

## Emergency fallback

If CV fails, say: “The camera-driven controls have a keyboard accessibility fallback,” then demonstrate the identical server-authoritative combat loop with buttons/keys. Do not attempt to debug CV in front of judges.
