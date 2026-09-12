# 01 — Characters

Two fighters. Identical stats and moves; they differ **only in look**. Rig proportions live in a per-character
table (`packages/client/src/game/rig/characters.ts`) so they can diverge later.

```ts
type CharacterId = "drifter" | "conductor";
```

## Shared rig proportions (px at standing height 150)

| Segment | Length | Thickness |
|---|---:|---:|
| Head radius | 16 | — |
| Neck | 8 | 10 |
| Torso (neck to hip) | 54 | see width below |
| Upper arm | 30 | 14 |
| Forearm | 28 | 12 |
| Fist radius | 9 | — |
| Thigh | 34 | 16 |
| Shin | 32 | 14 |
| Foot | 22 long | 8 |

Hip joint sits at `feet.y - 66`. Shoulder line at `hip.y - 54`. Head centre at `shoulder.y - 8 - 16`.

---

## Drifter — `drifter` (player 0)

**Read:** a shaggy, bearded man in ripped old clothes who has been riding this train a long time and was never a passenger. He fights low, wide and dirty.

| Field | Value |
|---|---|
| Key colour | `drifter-key` `#8A6B4A` |
| Skin | `drifter-skin` |
| Silhouette | Wide, low, asymmetric. Hunched shoulders, loose hanging layers, hair and beard breaking the outline |
| Torso width | 44 at shoulders, 40 at hips |
| Stance | Feet 46 px apart, knees bent 12°, torso leaned 6° forward, fists loose at hip height |
| Signature shapes | **Beard**: a rounded triangle from chin down 22 px, `drifter-key` darkened, edge jagged with 3 notches. **Hair**: 4 wind-blown wedges trailing screen-left from the crown, 18 to 30 px, the longest flapping ±3 px at 6 Hz. **Ripped coat**: torso drawn as the base quad plus 5 ragged triangles hanging off the bottom edge and 2 off the back edge, all streaming screen-left. **Torn trouser cuff**: one shin drawn 4 px shorter with a notch. **Rope belt**: a 3 px `amber-2` line across the hip |
| Hands | Bare, `drifter-skin`, with a 4 px `amber-2` wrap band on each forearm |
| Colour discipline | Browns and dust-greys only. **No blue** |

Hair and coat fringe are drawn with a small constant x offset opposite to the train's motion (screen-left) so the
wind reads in every pose.

---

## Conductor — `conductor` (player 1)

**Read:** the train's conductor, uniform buttoned to the collar, absolutely certain he is in the right. He fights upright and by the book.

| Field | Value |
|---|---|
| Key colour | `conductor-key` `#1B2A5C` |
| Skin | `#E9C9AE` |
| Silhouette | Narrow, vertical, sharp. Peaked cap is the signature and must survive every pose including KO |
| Torso width | 36 at shoulders, 32 at hips |
| Stance | Feet 30 px apart, knees straight, torso upright, fists up at chin height (boxing guard) |
| Signature shapes | **Cap**: a flat rounded rect 36 × 10 on the crown plus a 14 × 4 brim toward facing, with a 4 px `conductor-glove` badge dot. **Buttons**: two columns of 3 dots, `amber-1`, on the torso. **Collar**: a 6 px `moon` wedge at the neck. **Coat tails**: 2 short rectangles off the hip trailing screen-left 8 px. **Watch chain**: a 2 px `amber-1` arc across the lower torso |
| Hands | `conductor-glove` gloves, high contrast against the coat so the punch reads |
| Colour discipline | Navy, brass, white. **No brown** |

The cap is part of the head group and translates with it; it never detaches.

## Facing and mirroring

All pose functions are authored facing screen-right. Rendering for a left-facing fighter multiplies every joint's
x offset from the hip by `facing` (-1). Asymmetric details (badge, hair direction) flip with the body; that is
acceptable. Wind-blown hair always trails screen-left regardless of facing, because the train moves right.
