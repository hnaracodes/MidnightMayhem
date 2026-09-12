# 11.05 — Arena integration (runs alone after every lane has merged)

## Purpose
Wire everything into the running game: sprites for N fighters, item and laser effects, map drawing, the new HUD,
sound, attract mode on the landing page, the dazzle overlay, and the debug boxes for beams and hazards. Then prove
it with headless play-throughs of every mode and map with two, three and four keyboard players.

## Files
Modify: `packages/client/src/game/ArenaScene.ts`, `src/game/config.ts`, `src/game/session.ts`, `src/game/effects.ts`
(N fighters; hit-stop and flashes per index), `src/game/punchHint.ts` (hint for throws/laser is not needed; ensure
punch hint ignores item punches), `src/main.ts` (camera/network/arena blocks), `tools/e2e/*.json`,
`implementation-docs/STATUS.md`, `docs/runbooks/demo.md`.
Create: `tools/e2e/match-4p.json`, `tools/e2e/modes.json`, `test/arenaGlue.test.ts` (pure helpers below).

## Depends on
8.01, 9.01–9.06, 10.01–10.03, 11.01–11.04 all merged on `main`.

## Exposes
`session.ts` adds: `config: MatchConfig`, `roster: RosterEntry[]`, `attract: readonly CharacterId[] | null`,
`reducedMotion: boolean`, `muted: boolean`, `sfx: Sfx | null`, `useVectorRig: boolean` (`?rig=vector`).

`ArenaScene.ts`:
- Fighters: `SpriteFighter[]` (or the vector rig when `useVectorRig`) sized to `state.fighters.length`, created lazily
  when the count changes; depth `2 + i`.
- Draw order per frame: stage → map layer → hazards (ItemFx.draw) → shadows → fighters back-to-front by x distance
  from the camera centre (nearest last) → item FX → effects → debug → HUD → dazzle overlay (depth 12, `white` at
  `dazzleAlpha`).
- `hands(i)` for ItemFx comes from `SpriteFighter.hand()` / vector `joints.arms[F].fist`.
- Item sprite visibility: `itemVisible = !itemFx.materialising(i)`.
- Attract mode: when `session.attract` is set and no snapshot exists, build a local fake `MatchState` (`createMatch`
  with `players` = attract length, characters from the list) and run `step` locally at 60 Hz with idle inputs so the
  four idle on the roof (walk one of them left/right on a 6 s loop by scripting inputs) — this is the one place the
  client runs the sim, and only with no server snapshot present.
- Events fan-out per frame: `effects.consume`, `itemFx.consume`, `session.sfx?.consume`, HUD reads state.
- Fire loop: `sfx.play("fire_loop_start")` when the first fire hazard appears, `fire_loop_stop` when none remain.
- `M` toggles `session.muted` → `sfx.setMuted`; first user gesture on the page creates the `AudioContext`.
- Debug boxes: laser beam rect, hazard rects, projectiles, platforms outline.
- Map change: `layers.map.setMap(state.config.map)` when the config's map differs from the drawn one.

`main.ts`: constructs `Sfx`, sets `session.config/roster` from `LOBBY`, passes `state` to `result.show`, keeps the
camera flow exactly as today, and the `LOBBY` → `Landing.hide()` transition.

Pure helpers for tests (`src/game/arenaGlue.ts`): `drawOrder(fighters): PlayerIndex[]`, `fireLoopTransition(prevHas, nowHas): "start" | "stop" | null`,
`attractInputs(tick): InputFrame[]`.

## Behaviour
1. Two-player keyboard match on `roof`/`rounds` looks and plays as before, now with sprites.
2. Landing shows four idling sprites on the moving train; entering a room removes them; the lobby shows the stage
   behind the panel.
3. Pressing `1` with a molotov in the loadout during a match → materialise FX at the hand, equip sound, bottle in
   hand; `F` throws it: arc, fire on the roof, damage ticks visible on the bar.
4. `Q` → charge ring, beam across the arena, the opponent's bar drops by 10 (or 4 blocked); ring in the HUD refills
   over 12 s.
5. `2` then `S` then the opponent's punch within 10 ticks → parry spark, the attacker staggers.
6. `3` → bubble; three hits crack and break it.
7. `4`, `F` → peel; the opponent walking over it slips (stars over the head).
8. `5`, `F` → the opponent's window goes white and fades over 2 s; the flasher's does not.
9. `gaps`: walking off the edge falls into the pit, the bar drops 8, the fighter reappears at the edge blinking
   (invuln drawn at 50 % alpha for 30 ticks). `platforms`: jumping onto a rack lands on it.
10. Four players 2v2: four bars, team colours, KO'd fighters stay collapsed and are not hit again; the result names
    the team. Three players FFA: three bars, last one standing wins.
11. `timed` shows `1:30` counting down; `deathmatch` shows `∞` and never times out.
12. `?rig=vector` draws the old rig with everything else working.
13. `M` mutes; the state persists across reloads.
14. `pnpm build` succeeds; `packages/server` serving `dist/` works for a two-window match.

## Invariants
- The scene still never touches the socket.
- Hit-stop freezes the newest snapshot for every fighter, as before.
- No frame spends more than 4 ms in `update()` with four fighters, four hazards and a beam on the headless driver
  (log `updateMs`).

## Tests
- `arenaGlue.test.ts` for the three pure helpers.
- Headless via `tools/shot.mjs` with `MM_HTTP=1` on ports 5181/8081: `match.json` (2p, as today), `match-4p.json`
  (four pages, `players: 4`, `2v2`, `chaos`, every key including 1–5 and Q, screenshots at equip, throw, beam, pit,
  KO, result), `modes.json` (timed and deathmatch). Every report must show zero page errors.

## Done when
- [ ] all of the above, `pnpm test`, `pnpm typecheck`, `pnpm build` green
- [ ] `.shots/integration-*.png` reviewed by the agent against rules 1–11
- [ ] `STATUS.md` rewritten: what landed, how to run, the human gates that remain (camera with real objects, four
  laptops over LAN)
- [ ] committed on `main` with prefix `integ:`
