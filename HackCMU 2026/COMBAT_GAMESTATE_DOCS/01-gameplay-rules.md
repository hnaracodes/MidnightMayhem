> **SUPERSEDED 2026-09-12.** This document is historical. The build follows `DECISIONS_CHANGED.md` (root) and `docs/superpowers/plans/2026-09-12-midnight-express-mvp.md`. Where this file disagrees with them, they win. Kept for reference only.

# Gameplay, Combat, and Hitbox Rules

## Integration constraint

These rules are server-authoritative and frozen for the protected vertical slice. Partner phases may render or react to public combat events, but cannot redefine damage, hitboxes, cooldowns, lanes, or winners. The integration owner approves any rule change after a working two-browser match is preserved.

## Exact per-tick player model

```ts
type PlayerState = {
  id: string; name: string; connected: boolean; hp: number; lane: 0 | 1 | 2;
  status: "IDLE" | "BLOCKING" | "DODGING" | "SCANNING" | "STUNNED";
  statusEndsAtTick: number; dodgeIFrameStartTick: number; dodgeIFrameEndTick: number;
  lastInputSeq: number; inputWindowStartTick: number; inputsInWindow: number;
  abilitySlots: [ObjectClass | null, ObjectClass | null, ObjectClass | null];
  cooldownEndsAtTick: [number, number, number]; scanCooldownEndsAtTick: number;
  scanToken: string | null; scanTokenExpiresAtTick: number; scanStartedAtTick: number;
};
```

Initialize every player with `hp=100`, `lane=1`, `status="IDLE"`, three seeded slots, and zero cooldowns. A damage application clamps HP to `max(0, hp - damage)`. A player at HP zero may not create a new attack, but all attacks created earlier in the same tick still resolve.

## Collision formulas

For a projectile, set `x0` to its previous x and `x1=x0+speedPerTick*direction`. It hits a target only when lane matches and its segment intersects the target x interval expanded by projectile half-width: `min(x0,x1) <= targetX+45+projectileHalfWidth && max(x0,x1) >= targetX-45-projectileHalfWidth`. Resolve once, append target ID to `hitPlayerIds`, then delete a single-hit projectile.

For lanes, `DODGE_LEFT` changes lane only if `lane > 0`; `DODGE_RIGHT` only if `lane < 2`. Invalid dodges emit `ACTION_REJECTED` and make no state change. The dodge i-frame interval is `[createdTick+3, createdTick+7]` inclusive. Block reduction is `Math.ceil(rawDamage * 0.30)`; it does not stack.

## World model

Use a logical world, not browser pixels.

```text
WORLD_WIDTH  = 1000
WORLD_HEIGHT = 480
PLAYER_A_X   = 130
PLAYER_B_X   = 870
LANE_Y       = [110, 240, 370]
PLAYER_HURTBOX = 90 × 120
```

Players are fixed at opposite ends. A player state contains a lane and status; it does not contain webcam coordinates.

## Player statuses

| Status | Can attack | Can block/dodge | Can take damage | Duration |
|---|---:|---:|---:|---|
| `IDLE` | yes | yes | yes | until changed |
| `BLOCKING` | no | no | yes, reduced | 18 ticks / 600 ms |
| `DODGING` | no | no | only outside i-frame | 10 ticks |
| `SCANNING` | no | no | yes | max 45 ticks / 1.5 sec |
| `STUNNED` | no | no | yes | ability-defined |

## Object kits

| Object class | Ability | Attack type | Effect |
|---|---|---|---|
| Bottle | Flow Shot | projectile | 18 damage in one lane |
| Book | Archive Wave | lane strike | 14 damage in current + adjacent lanes |
| Backpack | Cargo Slam | zone | 25 damage in current lane, long cooldown |
| Cup | Steam Screen | zone | 12 damage; grants dodge bonus to source |
| Cell phone | Sonic Tunnel | lane strike | 10 damage + short stun |

Keep these server constants in one shared ability-definition file. The client reads them only for presentation; the server enforces them.

## Action timing

Every ability has `windupTicks`, `activeTicks`, `recoveryTicks`, and `cooldownTicks`.

```text
Input accepted → windup → attack active → recovery → cooldown available
```

The server creates an attack instance at acceptance. Collision is evaluated only during its active ticks. Every attack has a `hitPlayerIds` set, so the same attack cannot hit the same target twice.

## Same-tick rule

All inputs accepted for a tick are first converted into statuses/attack instances. Collision is resolved only after every valid input for that tick has been applied. Therefore, two attacks that become active in the same tick can both land; a same-tick double knockout is a draw.

Use a stable player-id sort only for reproducible bookkeeping. It must never decide which same-tick attack lands.

## Collision rules

### Projectile

- Spawn at the source player's logical x and current lane.
- Advance at fixed speed once per server tick.
- Test the swept segment from previous x to current x against the target hurtbox expanded by projectile radius.
- Expire on first valid hit or after 1.5 seconds.
- Never test the source player as a projectile target.

Swept collision is required; point-in-rectangle checks alone allow fast projectiles to tunnel through a target between ticks.

### Lane strike and zone

- Test only on active ticks.
- A hit requires that the target lane belongs to the ability's `affectedLanes`.
- A hit is rejected if the target has active dodge invulnerability.

### Block and dodge

- Block reduces valid incoming damage by 70%.
- Dodge changes to one adjacent lane; reject moves beyond lane 0–2.
- Dodge invulnerability exists only on ticks 3–7 of the ten-tick dodge. It cannot be used as permanent immunity.
- Dodge cooldown: 60 ticks / 2 seconds.

## Baggage Scan

1. Player sends `SCAN_START`.
2. Server verifies a six-second scan cooldown and sets `SCANNING` with a random scan token.
3. Client activates object detection locally.
4. Client submits one confirmed class before scan expiry.
5. Server validates the token, class allowlist, and confidence threshold.
6. Server adds the corresponding ability to an empty slot; if all slots are occupied, replace the oldest slot.
7. Server returns player to `IDLE`.

During scanning, the player cannot act and remains damageable. This makes new objects strategic rather than free power-ups.

## Train events

| Event | Trigger | Server effect |
|---|---|---|
| Tunnel | 20 seconds remain | Sonic Tunnel damage multiplier is 1.25; renderer darkens |
| Final Car | 10 seconds remain | each player’s power cooldowns reset once |

Train events are server state. The client may animate them, but cannot decide their timing.
