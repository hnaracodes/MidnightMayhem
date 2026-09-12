/**
 * 09-arsenal/01 — the item slot: equipping from the input frame, and the three items that live entirely inside
 * melee resolution (sword, shield, flash). Molotov and banana throws are 09.02 (`projectiles.ts`); laser is 09.03.
 */
import { ARSENAL, ITEMS, type ItemId } from "../constants";
import type { InputFrame } from "../input";
import { opponentsOf } from "./combat";
import { startThrow } from "./projectiles";
import type { Arm, MatchState, PlayerIndex, SimEvent } from "./types";

/** Counts down laserCooldown, dazzle, invuln and a timed item's ticksLeft for every fighter (blockTicks is driven by controlFighter). */
export function tickCooldowns(s: MatchState, events: SimEvent[] = []): void {
  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i]!;
    if (f.laserCooldown > 0) f.laserCooldown--;
    if (f.dazzle > 0) f.dazzle--;
    if (f.slipped > 0) f.slipped--;
    if (f.invuln > 0) f.invuln--;
    // 9.10: a timed item (sword) drains while held, KO'd or down a pit alike; at 0 the slot clears.
    if (f.item && f.item.ticksLeft !== null) {
      f.item.ticksLeft--;
      if (f.item.ticksLeft <= 0) {
        const kind = f.item.kind;
        f.item = null;
        events.push({ type: "ITEM_BREAK", player: i as PlayerIndex, item: kind });
      }
    }
  }
}

/**
 * Spec §4.2: items on, COUNTDOWN or FIGHTING, unused this round, hands free, not stunned, alive, not in a pit.
 * Owner 2026-09-12 (decision 52): the loadout no longer gates equipping — any of the five objects works when held.
 */
export function canEquip(s: MatchState, i: PlayerIndex, item: ItemId): boolean {
  const f = s.fighters[i];
  if (!f) return false;
  if (!s.config.items) return false;
  if (s.phase !== "COUNTDOWN" && s.phase !== "FIGHTING") return false;
  if (f.itemsUsed.includes(item)) return false;
  if (f.item !== null) return false;
  if (f.hitstun !== 0) return false;
  if (f.hp <= 0) return false;
  if (f.pitTicks !== 0) return false;
  return true;
}

/**
 * Equips the item in view whenever `canEquip` allows it (owner 2026-09-12: not only on the `item` edge — a phone
 * that stays in view while the hands are busy equips as soon as they are free; `itemsUsed` keeps it once a round).
 */
export function applyEquip(s: MatchState, i: PlayerIndex, input: InputFrame, events: SimEvent[]): void {
  const f = s.fighters[i];
  if (!f) return;
  const item = input.item;
  if (item === null) return;
  if (!canEquip(s, i, item)) return;
  f.item = { kind: item, uses: ITEMS[item].uses, ticksLeft: ITEMS[item].ttl ?? null };
  f.itemsUsed.push(item);
  events.push({ type: "ITEM_EQUIP", player: i, item });
}

/** Spends one use of the held item; at 0 the item breaks and the slot clears. A timed item (ticksLeft) is free. */
export function consumeUse(s: MatchState, i: PlayerIndex, events: SimEvent[]): void {
  const f = s.fighters[i];
  if (!f || !f.item) return;
  if (f.item.ticksLeft !== null) return;
  const kind = f.item.kind;
  f.item.uses--;
  events.push({ type: "ITEM_USE", player: i, item: kind });
  if (f.item.uses <= 0) {
    f.item = null;
    events.push({ type: "ITEM_BREAK", player: i, item: kind });
  }
}

/**
 * The held item gets first refusal of a punch edge. True when it consumed the edge; false falls through to a
 * normal punch (shield, no item, or a throwable before 09.02 merges).
 */
export function usePunchWithItem(s: MatchState, i: PlayerIndex, arm: Arm, events: SimEvent[]): boolean {
  const f = s.fighters[i];
  if (!f || !f.item) return false;
  switch (f.item.kind) {
    case "sword":
      // Owner 2026-09-12: a punch with the sword is the sword swing (SWORD_REACH / SWORD_DAMAGE); the timer, not
      // uses, ends the sword. `startSlash` (E / R) stays for the keyboard.
      f.action = { kind: "punch", arm, elapsed: 0, landed: false, sword: true };
      events.push({ type: "PUNCH", player: i, arm });
      return true;
    case "flash":
      // `landed: true` from the start: this swing can never connect.
      f.action = { kind: "punch", arm, elapsed: 0, landed: true, sword: false };
      for (const j of opponentsOf(s, i)) s.fighters[j]!.dazzle = ARSENAL.DAZZLE_TICKS;
      events.push({ type: "FLASH", player: i });
      consumeUse(s, i, events);
      return true;
    case "molotov":
    case "banana":
      return startThrow(s, i, arm, events);
    case "shield":
      return false;
  }
}

/** 9.10: a chop / sweep edge starts a SlashAction only with a sword in hand; otherwise the edge is ignored. */
export function startSlash(s: MatchState, i: PlayerIndex, style: "chop" | "sweep", events: SimEvent[]): boolean {
  const f = s.fighters[i];
  if (!f || !f.item || f.item.kind !== "sword") return false;
  f.action = { kind: "slash", style, elapsed: 0, landed: false };
  events.push({ type: "SLASH", player: i, style });
  return true;
}

/** A held shield absorbs the hit: SHIELD_ABSORB (with hits left) then the use is spent, possibly breaking it. */
export function absorbWithShield(s: MatchState, i: PlayerIndex, events: SimEvent[]): boolean {
  const f = s.fighters[i];
  if (!f || !f.item || f.item.kind !== "shield") return false;
  events.push({ type: "SHIELD_ABSORB", player: i, left: f.item.uses - 1 });
  consumeUse(s, i, events);
  return true;
}
