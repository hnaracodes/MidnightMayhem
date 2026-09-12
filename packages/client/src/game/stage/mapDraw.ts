/**
 * 11.02 — Map drawing: gaps as broken roof with couplings, platforms as cargo racks.
 *
 * Geometry comes from `MAPS` in shared constants so what the sim collides with is exactly what the player sees.
 * Everything is Graphics; the track visible in a gap is a slice of the existing `bg_track_trail` texture.
 */
import Phaser from "phaser";
import { MAPS, WORLD, type MapId } from "@midnight/shared";
import { P } from "../palette";
import type { Layers } from "../backgrounds";

export interface MapLayer {
  /** Gap masks and couplings, depth just above the wheels so the roof, body and bogies vanish over each pit. */
  gaps: Phaser.GameObjects.Graphics;
  /** Cargo racks, behind the fighters. */
  platforms: Phaser.GameObjects.Graphics;
  setMap(map: MapId): void;
  /** Track slices visible in each gap; they scroll at roof speed and bob with the train. */
  slices: Phaser.GameObjects.TileSprite[];
  /** What is currently drawn, for tests and the preview. */
  readonly spans: { gaps: { x0: number; x1: number }[]; platforms: { x0: number; x1: number; y: number }[] };
  /** Scrolls the gap track slices. Driven by `scrollBackgrounds`. */
  update(dtSec: number, roofSpeed: number): void;
  destroy(): void;
}

/** Depths: gaps sit above the wheels (-9.5); racks sit under the shadow (1) and rigs (2+). */
export const MAP_DEPTH = { gaps: -9.3, slice: -9.29, platforms: -6 } as const;

const GAP = {
  wall: 4, lip: 6, bufferW: 14, bufferH: 10, bufferY: 444, barY: 458, barH: 10, stripe: 8, trackY: 480, trackH: 60,
} as const;
const RACK = { slab: 12, lip: 2, rivetEvery: 24, leg: 4, legInset: 10, underlight: 6 } as const;

function drawGap(g: Phaser.GameObjects.Graphics, x0: number, x1: number): void {
  const top = WORLD.ROOF_Y;
  const bottom = WORLD.HEIGHT;
  // Mask: night-0 over roof, glow, body and wheels.
  g.fillStyle(P.night0, 1);
  g.fillRect(x0, top, x1 - x0, bottom - top);
  // Car-end walls with a moonlit lip on each roof edge.
  g.fillStyle(P.outline, 1);
  g.fillRect(x0 - GAP.wall, top, GAP.wall, 70);
  g.fillRect(x1, top, GAP.wall, 70);
  g.fillStyle(P.steel2, 1);
  g.fillRect(x0 - GAP.lip, top, GAP.lip, 3);
  g.fillRect(x1, top, GAP.lip, 3);
  g.fillStyle(P.steel1, 1);
  g.fillRect(x0 - GAP.wall, top + 3, 2, 67);
  g.fillRect(x1 + GAP.wall - 2, top + 3, 2, 67);
  // Two buffers, one per car end, with a dark face plate.
  for (const bx of [x0, x1 - GAP.bufferW]) {
    g.fillStyle(P.outline, 1);
    g.fillRect(bx - 1, GAP.bufferY - 1, GAP.bufferW + 2, GAP.bufferH + 2);
    g.fillStyle(P.steel2, 1);
    g.fillRect(bx, GAP.bufferY, GAP.bufferW, GAP.bufferH);
    g.fillStyle(P.steel0, 1);
    g.fillRect(bx === x0 ? bx + GAP.bufferW - 4 : bx, GAP.bufferY, 4, GAP.bufferH);
  }
  // Coupling bar with a danger warning stripe.
  const barX0 = x0 + 6;
  const barX1 = x1 - 6;
  g.fillStyle(P.outline, 1);
  g.fillRect(barX0 - 1, GAP.barY - 1, barX1 - barX0 + 2, GAP.barH + 2);
  g.fillStyle(P.steel0, 1);
  g.fillRect(barX0, GAP.barY, barX1 - barX0, GAP.barH);
  g.fillStyle(P.danger, 0.85);
  for (let sx = barX0 + 4; sx + GAP.stripe <= barX1 - 4; sx += GAP.stripe * 2) g.fillRect(sx, GAP.barY + 2, GAP.stripe, GAP.barH - 4);
  // Knuckle in the middle of the bar.
  const mid = (x0 + x1) / 2;
  g.fillStyle(P.outline, 1);
  g.fillRect(mid - 5, GAP.barY - 4, 10, GAP.barH + 8);
  g.fillStyle(P.steel2, 1);
  g.fillRect(mid - 3, GAP.barY - 2, 6, GAP.barH + 4);
}

function drawRack(g: Phaser.GameObjects.Graphics, x0: number, x1: number, y: number): void {
  const w = x1 - x0;
  // Underlight on the roof beneath the rack.
  g.fillStyle(P.amber1, 0.2);
  g.fillRect(x0, WORLD.ROOF_Y, w, RACK.underlight);
  g.fillStyle(P.amber1, 0.08);
  g.fillRect(x0 - 8, WORLD.ROOF_Y, w + 16, RACK.underlight * 2);
  // Legs with cross-bracing down to the roof.
  const legTop = y + RACK.slab;
  const legH = WORLD.ROOF_Y - legTop;
  const lx0 = x0 + RACK.legInset;
  const lx1 = x1 - RACK.legInset - RACK.leg;
  g.lineStyle(2, P.outline, 1);
  g.beginPath();
  g.moveTo(lx0 + RACK.leg / 2, legTop);
  g.lineTo(lx1 + RACK.leg / 2, WORLD.ROOF_Y);
  g.moveTo(lx1 + RACK.leg / 2, legTop);
  g.lineTo(lx0 + RACK.leg / 2, WORLD.ROOF_Y);
  g.strokePath();
  for (const lx of [lx0, lx1]) {
    g.fillStyle(P.outline, 1);
    g.fillRect(lx - 1, legTop, RACK.leg + 2, legH);
    g.fillStyle(P.steel0, 1);
    g.fillRect(lx, legTop, RACK.leg, legH);
    g.fillStyle(P.steel2, 0.6);
    g.fillRect(lx, legTop, 1, legH);
  }
  // Slab: top edge is exactly platform.y so feet sit on it.
  g.fillStyle(P.outline, 1);
  g.fillRect(x0 - 1, y - 1, w + 2, RACK.slab + 2);
  g.fillStyle(P.steel1, 1);
  g.fillRect(x0, y, w, RACK.slab);
  g.fillStyle(P.steel0, 1);
  g.fillRect(x0, y + RACK.slab - 3, w, 3);
  g.fillStyle(P.steel2, 1);
  g.fillRect(x0, y, w, RACK.lip);
  for (let rx = x0 + 6; rx < x1 - 3; rx += RACK.rivetEvery) g.fillRect(rx, y + 5, 3, 3);
  // Warm glow on the underside of the slab from the roof windows.
  g.fillStyle(P.amber1, 0.12);
  g.fillRect(x0, y + RACK.slab - 3, w, 3);
}

export function createMapLayer(scene: Phaser.Scene, _layers: Pick<Layers, "tiles">): MapLayer {
  const gaps = scene.add.graphics().setDepth(MAP_DEPTH.gaps);
  const platforms = scene.add.graphics().setDepth(MAP_DEPTH.platforms);
  let slices: Phaser.GameObjects.TileSprite[] = [];
  const spans: MapLayer["spans"] = { gaps: [], platforms: [] };

  const layer: MapLayer = {
    gaps,
    platforms,
    slices,
    spans,
    setMap(map: MapId): void {
      const def = MAPS[map];
      gaps.clear();
      platforms.clear();
      for (const s of slices) s.destroy();
      slices = [];
      spans.gaps = [];
      spans.platforms = [];
      const ground = def.ground;
      for (let i = 1; i < ground.length; i++) {
        const x0 = ground[i - 1]!.x1;
        const x1 = ground[i]!.x0;
        if (x1 <= x0) continue;
        spans.gaps.push({ x0, x1 });
        drawGap(gaps, x0, x1);
        const inset = GAP.wall + 2;
        const slice = scene.add.tileSprite(x0 + inset, GAP.trackY, x1 - x0 - inset * 2, GAP.trackH, "bg_track_trail")
          .setOrigin(0, 0).setDepth(MAP_DEPTH.slice);
        slices.push(slice);
      }
      for (const p of def.platforms) {
        spans.platforms.push({ x0: p.x0, x1: p.x1, y: p.y });
        drawRack(platforms, p.x0, p.x1, p.y);
      }
      layer.slices = slices;
    },
    update(dtSec: number, roofSpeed: number): void {
      for (const s of slices) s.tilePositionX += roofSpeed * dtSec;
    },
    destroy(): void {
      gaps.destroy();
      platforms.destroy();
      for (const s of slices) s.destroy();
      slices = [];
    },
  };
  return layer;
}
