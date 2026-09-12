# UI design notes — landing and lobby (11.03)

Date: 2026-09-12. Written by the `feat/ui` lane before any CSS, as the `frontend-design` skill asks. Pass 1 is the
plan; pass 2 is the review against the generic-defaults list, with what changed.

## Brief in one line

A night train, four fighters idling on its roof, and one clear way aboard. Then a carriage manifest where each
player picks a seat (character, two items) and the host sets the route (players, teams, mode, map, items).
Offline demo on a LAN: no network fonts, every visual is code.

## Pass 1 — token plan

### Colour (from `design/00`, plus the four character keys mirrored from 11.01)

| Token | Hex | Role on these screens |
|---|---|---|
| `night-0` | `#070B18` | Scrim base. Landing scrim is a top-heavy gradient (90 % at the top, 15 % at the roof line) so the train stays lit. Lobby scrim 88 %. |
| `night-1` | `#101A33` | Panels: ticket, seats, board rows. |
| `steel-2` | `#5B6375` | Secondary text, disabled controls, empty seats. |
| `moon` | `#E8F0FF` | Primary text, focus ring, selected-state ink. |
| `amber-1` | `#F2A03D` | The one accent: the room code, the ticket edge, selected segments, the ready mark, the primary button. |
| `amber-2` | `#C2601B` | Title offset shadow, warm shadow under the ticket. |
| `danger` | `#E8434F` | Lose verdict only. |
| Character keys | drifter `#8A6B4A`, conductor `#1B2A5C`, stoker `#4A4E57`, claude `#D97757` | Seat swatch, portrait fill. Team A/B tints in 2v2: `amber-1` / `moon`. |

### Type (system stacks only)

- **Display**: `"Avenir Next Condensed", Bahnschrift, "Arial Narrow", "Helvetica Neue", Impact, sans-serif`,
  weight 800. Condensed heavy sans is the railway-poster and arcade-cabinet voice at once, and every OS ships one.
  Roles: the title (72 px, tracking 0.03 em, hard 6 px `amber-2` offset), the room code (64 px, tracked 0.25 em),
  section heads in the lobby (22 px), button labels (18 px).
- **Text**: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Roles: invitation line (20 px), form
  fields (18 px), control values (16 px), legend and helper copy (14 px). Sentence case everywhere except the
  title, the room code and the character names, which the game already shouts in caps.
- Scale: 14 / 16 / 18 / 22 / 28 / 44 / 72. Line height 1.2 for display, 1.45 for text.

### Layout

Landing (960 × 540, the canvas is under everything and shows the roof at y ≈ 430):

```
+--------------------------------------------------------------+
|  MIDNIGHT MAYHEM                                             |   title, left, top band
|  four of you, one roof, no brakes.                           |   invitation, one line
|                                                              |
|   +- - - - - - - - - - - - - - - - - - +                     |   the ticket: name, room code,
|   | Your name [__________]  Room [____]| BOARD THE TRAIN     |   one primary action; perforated
|   +- - - - - - - - - - - - - - - - - - +                     |   left edge, amber right edge
|                                                              |
|          o        o          o         o                     |   the four idling on the roof (canvas)
|  ============================================================ |   roof line ~ y 430
|  A/D walk  W jump  S block  F/G punch  Q laser  1-5 items ...|   legend, bottom strip over the train body
+--------------------------------------------------------------+
```
Left-aligned; the text column is 560 px wide and never reaches below y ≈ 300, leaving the roof clear.
At 400 px wide the ticket stacks its fields; the legend wraps.

Lobby (960): two columns, left the manifest, right the route board and customise; stacks at 400.

```
+---------------------------+-----------------------------------+
| Room  K7QX                | Route            (host only live) |
| +-----------------------+ |  Players   [2] [3] [4]            |
| | [pt] Ana  THE DRIFTER | |  Teams     [free-for-all] [2v2]   |
| |  molotov shield  host✓| |  Mode      [rounds][timed][death] |
| +-----------------------+ |  Map       [roof][gaps][plat][chaos]
| | [pt] seat 2  waiting  | |  Items     [on] [off]             |
| +-----------------------+ |  "2 players, best of 3 on Roof…"  |
|                           | Your seat                         |
| [Enable camera]  [READY]  |  [pt][pt][pt][pt]  portraits      |
|                           |  [bottle][umbrella][pack][ban][ph]|
+---------------------------+-----------------------------------+
```

### Principles

1. **The train carries the page.** The DOM is quiet and stays out of the lower half on the landing so the
   live stage with four idle fighters is the hero. Nothing in the DOM animates on load; the only motion is the
   train, and it stops for `prefers-reduced-motion`.
2. **One accent, spent once per screen.** Amber marks the way in (Board the train) and, in the lobby, the
   room code and the current choice. Everything else is moon on night.
3. **Railway vernacular, not SaaS chrome.** A perforated ticket, a seat manifest, a route board with segmented
   choices. Borders encode meaning: the amber edge is "yours / current", steel is "someone else's / not yet".
4. **Copy says what happens.** "Board the train", "Ready", "Waiting for 2 more", "bring a water bottle".

## Pass 2 — review against the generic-defaults list

- *Warm cream + serif + terracotta*: no. Night palette is fixed by `design/00`. The Claude Code character key
  is `#D97757` by 11.01's spec; it appears only as that character's swatch, never as a UI accent.
- *Near-black + one acid accent*: the palette is near-black with an amber accent, which the brief pins
  (`design/00`, the existing lobby). Kept, but the night is `#070B18`, a real blue-black, not tinted `#111`, and
  the landing scrim is a gradient that lets the stage through rather than a flat dark.
- *Broadsheet hairlines / zero radius*: no hairlines; 2 px borders, 6–8 px radius on panels, 3 px on tiles.
- *SaaS card kit*: first draft had the roster, route board and customise as three identical rounded cards with the
  same shadow. **Changed**: only seats are cards (they are seats); the route board is rows of segmented
  buttons with no card around it; customise is two open rows. No drop shadows except the title's hard offset.
- *Template chrome*: first draft had `ROOM CODE`, `PLAYERS`, `YOUR LOADOUT` as tracked all-caps eyebrows and
  `name · ready` meta strings. **Changed**: sentence-case row labels ("Players", "Your seat"), the ready state is
  a mark on the seat, not a string; no middle dots; no mono for data; no arrows on buttons. Caps stay only where
  the game already uses them: the title, the room code, the character names, the primary button.
- *Numbered markers*: seats are not numbered (01/02); they are named by their occupant, and empty ones say
  "empty seat".
- *Motion*: none in the DOM on load. The one motion is the live train behind the page.
- *Typeface*: not `Inter`/`system-ui` for display; a condensed heavy stack chosen for the railway-poster voice.

## Pass 3 — retro chrome (13.01, owner: "should scream Midnight Express / retro video game")

Reviewed against screenshots of the live pages on 2026-09-12. What the pass found: the landing composition
was strong but the title was whatever condensed system face each laptop had (Avenir Next on macOS,
Bahnschrift on Windows), so the two machines showed different titles; the lobby read as a settings panel over
a painting, with 17 outlined-amber chips and an outlined Ready; the verdict clipped at 400 px; and `Scale.FIT`'s
centring margin collapsed through `#game`/`body`, making the page 47 px taller than the viewport mid-match.

What changed:

- **Type**: the display voice is now the game's own 5 × 7 pixel face, drawn in code (`src/app/pixelFont.ts`,
  same bevel / outline / block-shadow language as the fighter grids), so both laptops draw identical lettering
  with no font file. `heavy` (strokes dilated one cell) for the logotype and the verdict; `regular` for the room
  code and the lobby heads. Each letter is its own canvas scaled by the `--cell` custom property
  (`image-rendering: pixelated`); the text stays in a visually hidden span for screen readers and tests.
  Buttons, chips, fields and helper copy keep the system stacks; they are controls, not lettering.
- **Motion** (revises principle 1): one authored entrance on the landing — letters slam down staggered by
  38 ms with an overshoot, then the invitation and ticket rise — and a glint that walks the title every 9 s.
  Off under `prefers-reduced-motion`. Nothing else in the DOM animates.
- **Chrome**: square corners everywhere the pixel face sits (buttons, ticket, seats, chips, tiles, banner);
  depth is a hard 3–6 px block in `outline`, never a blur. The primary button is always filled amber (Board,
  Ready, Rematch); a pressed Ready inverts to amber-on-night. Unselected route chips drop to `steel-0` borders
  and `bone` ink so only the current choice is amber.
- **Lobby**: the four idlers stay on the roof under the lobby (`session.attract` is kept until the match
  starts); the scrim is a gradient like the landing's, opaque behind the columns and open below them.
- **Fix**: `#game` is a flex container of viewport height, which stops the canvas margin collapsing.

Not done, noted for later: a "Leave" next to the room code, "Retry" in the server banner, a one-line hint
under Enable camera for first-timers, the key legend repeated in the lobby, and the in-match HUD (still the
Phaser display face; the pixel face can replace names and the clock there in a follow-up).
