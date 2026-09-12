> **SUPERSEDED 2026-09-12.** This document is historical. The build follows `DECISIONS_CHANGED.md` (root) and `docs/superpowers/plans/2026-09-12-midnight-express-mvp.md`. Where this file disagrees with them, they win. Kept for reference only.

# Build Order and Integration Gates

> This document governs the **combat phase only**. When merging the three partner specifications, use `07-partner-integration-contract.md` as the boundary: their features call the combat adapter and consume its public outputs; they do not alter combat state or socket behavior directly.

## Integration-owner responsibilities

**Owner:** project lead/integration owner.

- Own `shared/game-types.ts`, `shared/abilities.ts`, socket event names, and the demo branch.
- Assign one contributor each to server/combat, game UI, and vision.
- Run a two-browser integration checkpoint every 60–90 minutes.
- Merge only after the relevant gate passes; keep a known-good vertical-slice commit available.
- Collect partner specifications without prematurely merging their code.

## Protected milestone — must work first

Two browsers join one room, choose pre-seeded kits, complete countdown, fight by keyboard/buttons, receive server-confirmed damage, and see the same `RESULT`. Until this works, do not begin CV, Baggage Scan, train modifiers, partner integration, or polish.

## Gate 1 — deterministic combat engine

**Owner:** game/server

- [ ] Ability definitions exist in a shared file.
- [ ] A pure `stepRoom(room, queuedInputs)` advances one tick.
- [ ] Projectile, lane-strike, block, dodge, and timer tests pass.
- [ ] Two fake players can complete a match without a browser.
- [ ] The room state machine follows `LOBBY → LOADOUT_SCAN → COUNTDOWN → PLAYING → RESULT`.

**Integration contract:** client receives `snapshot`, `event`, and `ack` names exactly as written in `02-network-state-protocol.md`.

## Gate 2 — two-player button match

**Owners:** game/server + client/game UI

- [ ] Two real browsers join one room.
- [ ] Both select a pre-seeded item kit.
- [ ] Button inputs create server-confirmed damage.
- [ ] HP, timer, winner, Tunnel, and Final Car render correctly.

**Do not start CV integration until this gate passes.**

## Gate 3 — pose replaces buttons

**Owners:** vision + client/game UI. **Only begin after the protected milestone passes.**

- [ ] Camera permission works from deployed HTTPS URL.
- [ ] Block, dodge left/right, and power produce local intent logs.
- [ ] Each intent invokes the same action dispatch function as buttons.
- [ ] Keyboard/buttons remain available as fallback.

## Gate 4 — mid-battle Baggage Scan

**Owners:** vision + game/server + client/game UI

- [ ] Server scan token, expiry, cooldown, and slot replacement tests pass.
- [ ] Scan mode pauses pose intent processing.
- [ ] Stable scan result adds a visible ability card on both clients.
- [ ] Unsupported/failed result becomes Mystery Parcel or returns cleanly.

## Gate 5 — demo hardening

**Owners:** everyone

- [ ] Test on both actual demo devices.
- [ ] Test in venue-like lighting and Wi-Fi.
- [ ] Preload models and verify no first-scan delay.
- [ ] Run the complete two-minute script three times without code changes.
- [ ] Freeze features after the final successful rehearsal.

## Merge protocol

1. Each owner works in their boundary; each partner lists its adapter calls and subscribed outputs before merging.
2. Shared type changes are announced before merge and approved by the protocol owner.
3. One integration owner merges branches in gate order.
4. After each merge, run the relevant gate before another feature merge.
5. Never merge visual polish into a branch with an unverified protocol change.
6. A partner phase may be temporarily mocked, but the final integration must use the same `CombatSessionAdapter` interface.

## Incoming partner-spec protocol

While the three partner documents are pending, reserve their boundaries but do not invent their requirements. When each document arrives:

1. Its owner writes a one-page adapter mapping: combat calls it needs, public combat outputs it renders, and any proposed new read-only field/event.
2. The integration owner compares that mapping with `07-partner-integration-contract.md`.
3. If current public types suffice, the partner develops against a mock adapter.
4. If they do not, the integration owner approves one atomic protocol change with tests and documentation.
5. Merge the partner only after the protected milestone still passes on two browsers.

## Exact repository tasks

```
pnpm-workspace.yaml                 # packages: client, server, shared
packages/shared/src/{types,constants,abilities,schemas}.ts
packages/server/src/{index,ws,rooms,simulation,combat,validate}.ts
packages/client/src/{main,App,canvas,wsClient,input,vision/pose,vision/yolo}.ts
packages/server/test/{simulation,protocol,rooms}.test.ts
```

Server owner implements `stepRoom(room: RoomState): StepResult` as a pure function before `ws.ts`. Network owner maps validated messages to a per-room `inputQueue`; only `simulation.ts` mutates room state. Client owner exposes `dispatchAction(action, slot?)`, and both keyboard and CV call only this function. Vision owner never imports server files. The integration owner alone changes exports in `packages/shared`.

## Definition of integrated

The project is integrated only when one deployed HTTPS URL lets two physical devices:

1. join one room;
2. complete initial loadout selection;
3. enter countdown together;
4. play a full 45-second match;
5. use a pose intent and keyboard fallback;
6. perform one mid-battle Baggage Scan;
7. see the same winner and rematch screen.
