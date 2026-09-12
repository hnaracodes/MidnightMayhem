# 11.03 — Landing page and lobby: character, loadout, match setup

## Purpose
The first thing anyone sees: a night sky, a moving train, the four fighters idling on the roof, and one clear way
in. Then a lobby where each player picks a character and two items, and the host sets players, teams, mode, map,
items. This is the lane the `frontend-design:frontend-design` skill is written for — the agent **must** invoke it,
write the token plan it asks for into `docs/superpowers/specs/2026-09-12-ui-design-notes.md`, and check the plan
against the generic-defaults list before writing CSS.

## Files
Modify: `packages/client/index.html` (structure and all CSS), `src/app/lobby.ts`, `src/app/result.ts`, `src/main.ts`
(only the lobby/landing wiring block and the two new handlers — leave the camera, network and arena blocks alone;
11.05 edits those after merge).
Create: `src/app/landing.ts`, `src/app/setup.ts` (host controls + customise widgets), `src/app/sprites/portrait.ts`
(character portraits rendered from 11.01's parts if merged — else a coloured silhouette placeholder behind a
`portrait(characterId): HTMLCanvasElement` function the integrator swaps), `test/landing.test.ts`, `test/setup.test.ts`,
extend `test/lobby.test.ts` if it exists (create it otherwise).
Owns `index.html`, `src/app/landing.ts`, `src/app/setup.ts`, `src/app/lobby.ts`, `src/app/result.ts`,
`src/app/sprites/**`, and the "Screens" block of `main.ts`.

## Depends on
8.01 (`MatchConfig`, `CHARACTERS`, `ITEMS`, `LobbyPlayer` with character/loadout, `CONFIG`/`CUSTOMIZE` messages).

## Exposes
`landing.ts`: `class Landing { constructor(h: { onEnter(name: string, roomId?: string): void }); render(): void; hide(): void }`
— sets `session.attract = CHARACTERS` (the arena scene draws the four idling on the roof behind the DOM; 11.05 reads it),
clears it on hide.

`setup.ts`:
- `class HostControls { constructor(onChange(config: MatchConfig)); render(root, config, enabled: boolean): void }` — players
  2/3/4, teams (only enabled at 4), mode, map, items on/off; disabled (read-only, still visible) for non-hosts.
- `class Customize { constructor(onChange(character, loadout)); render(root, current, taken: CharacterId[]): void }` —
  character picker (four portraits; a character already taken by another player is shown but not selectable in 2v2? No:
  duplicates are allowed — two Claude Codes is funny; the `taken` list only adds a small "also P2" tag) and a loadout
  picker: five item tiles, exactly two selected, with `ITEMS[id].uses` shown as pips and the real-world object named
  ("bring a water bottle").
- `describeConfig(config): string` — one plain sentence: "4 players, 2v2, best of 3 on Chaos, items on".

`lobby.ts`: `renderRoom(roomId, players, config, host, localIndex, visionAvailable, cameraButton)` — roster of
`config.players` rows (character portrait, name, loadout glyphs, ready state, team colour when 2v2, "host" mark),
`HostControls`, `Customize`, camera button, Ready. Handlers gain `onConfig(config)`, `onCustomize(character, loadout)`.

`result.ts`: `show(winner: Winner, state: MatchState, localIndex)` — FFA: the winning character's label; 2v2: "TEAM A/B
WINS" with both names; draw text unchanged.

`main.ts`: routes `Landing → Lobby`, sends `CONFIG` / `CUSTOMIZE`, stores `session.config` / `session.roster` from the
`LOBBY` message (add both fields to `session.ts` — this lane may add fields to `session.ts`; 11.05 adds its own).

## Behaviour
1. Landing: the title, a one-line invitation, name field, optional room code, one primary action "Board the train"
   (enter). The four characters idle on the moving roof behind it (attract mode). Reduced-motion users get a still
   train (the arena reads `session.reducedMotion`; set it from `matchMedia`).
2. The design must not use network fonts (the demo runs on a LAN without internet); system stacks only, chosen and
   sized deliberately. The token plan in the notes file lists the 4–6 colours (from `design/00`), the type roles, the
   layout sketch, and the one element that carries the page.
3. Lobby, host: every control live; changing one sends `CONFIG` once (debounced 150 ms) and un-readies everyone
   (the server does that; the client re-renders from `LOBBY`).
4. Lobby, guest: controls visible, disabled, with `describeConfig` under them.
5. Customise: picking a character or toggling items sends `CUSTOMIZE` when exactly two items are selected; a third
   click replaces the older selection; the sender's row updates from the next `LOBBY`.
6. Ready is disabled until the room has `config.players` players; the button says "Waiting for N more".
7. Keyboard legend on the landing lists every key: A/D walk, W jump, S block, F/G punch, Q laser, 1–5 items, V preview,
   M mute.
8. Result: 2v2 → team wording; FFA with three → the winner's name; rematch returns to the lobby with the same config.
9. Everything works at 960 px and at 400 px wide (the lobby stacks), with visible focus rings.

## Invariants
- No React, no framework; DOM built the way `lobby.ts` already does it.
- Palette tokens only (`design/00` plus the four new character colours from 11.01, mirrored as CSS variables).
- The arena canvas stays under every overlay from the first frame (4.08 rule 1).

## Tests
`landing.test.ts`: render produces the form, `onEnter` receives trimmed name and upper-cased code, `attract` set/cleared.
`setup.test.ts`: `HostControls` disables teams unless players 4; `Customize` keeps exactly two items and emits only
then; `describeConfig` wording. `lobby.test.ts`: roster row count follows `config.players`; guest controls disabled;
Ready label with missing players.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] `frontend-design` skill invoked; notes file written and self-reviewed against the generic-defaults list
- [ ] headless screenshots `.shots/landing.png`, `.shots/lobby-host.png`, `.shots/lobby-guest.png` (two pages via
  `tools/shot.mjs` steps) reviewed by the agent
- [ ] committed on `feat/ui` with prefix `client:`
