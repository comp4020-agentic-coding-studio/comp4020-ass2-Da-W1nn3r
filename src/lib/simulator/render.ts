// Canvas rendering. Deliberately schematic rather than pixel-art-accurate —
// this is a throughput/bottleneck teaching tool, not a Factorio skin. Every
// entity is a flat-coloured tile with a direction arrow where relevant, plus
// small text/dot overlays for state (items on a belt, an assembler's recipe
// and progress bar, a sink's running total).

import { DIR_DELTA, oppositeDir } from "./types";
import type { Direction, Entity, Vec2 } from "./types";
import { entityAt, footprintTiles, type SimState } from "./grid";
import { CHEST_SLOTS, POLE_SPEC } from "./constants";
import { chestSlotsUsed } from "./entities/chest";
import { connectedPolePairs } from "./entities/power";

export const TILE = 28;

const COLORS: Record<Entity["kind"], string> = {
  belt: "#8a8f98",
  "underground-belt": "#5f6570",
  splitter: "#4d8ff0",
  inserter: "#e0a336",
  assembler: "#7fb069",
  pole: "#d1495b",
  "item-source": "#6c5ce7",
  "item-sink": "#2b2d42",
  chest: "#b08968",
  "inf-loader": "#00b4d8",
};

function footprintSize(e: Entity): { w: number; h: number } {
  const tiles = footprintTiles(e);
  const w = Math.max(...tiles.map((t) => t.x)) - Math.min(...tiles.map((t) => t.x)) + 1;
  const h = Math.max(...tiles.map((t) => t.y)) - Math.min(...tiles.map((t) => t.y)) + 1;
  return { w, h };
}

function drawArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, dir: Direction, size: number): void {
  const d = DIR_DELTA[dir];
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - (d.x * size) / 2, cy - (d.y * size) / 2);
  ctx.lineTo(cx + (d.x * size) / 2, cy + (d.y * size) / 2);
  const perp = { x: -d.y, y: d.x };
  ctx.lineTo(cx + (d.x * size) / 2 - d.x * 5 + perp.x * 4, cy + (d.y * size) / 2 - d.y * 5 + perp.y * 4);
  ctx.moveTo(cx + (d.x * size) / 2, cy + (d.y * size) / 2);
  ctx.lineTo(cx + (d.x * size) / 2 - d.x * 5 - perp.x * 4, cy + (d.y * size) / 2 - d.y * 5 - perp.y * 4);
  ctx.stroke();
}

/** Same arrowhead style as `drawArrow`, but entering from `fromSide` (the side of the
 * tile the feed comes from) and bending to exit toward `dir` — used to draw a belt
 * corner as an L-shaped turn instead of a straight run. */
function drawBentArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  fromSide: Direction,
  dir: Direction,
  size: number,
): void {
  const inD = DIR_DELTA[fromSide];
  const outD = DIR_DELTA[dir];
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx + (inD.x * size) / 2, cy + (inD.y * size) / 2);
  ctx.lineTo(cx, cy);
  ctx.lineTo(cx + (outD.x * size) / 2, cy + (outD.y * size) / 2);
  const perp = { x: -outD.y, y: outD.x };
  ctx.lineTo(cx + (outD.x * size) / 2 - outD.x * 5 + perp.x * 4, cy + (outD.y * size) / 2 - outD.y * 5 + perp.y * 4);
  ctx.moveTo(cx + (outD.x * size) / 2, cy + (outD.y * size) / 2);
  ctx.lineTo(cx + (outD.x * size) / 2 - outD.x * 5 - perp.x * 4, cy + (outD.y * size) / 2 - outD.y * 5 - perp.y * 4);
  ctx.stroke();
}

function isBeltLike(e: Entity | undefined): e is Entity & { dir: Direction } {
  return !!e && (e.kind === "belt" || e.kind === "underground-belt");
}

/** If `e` is fed from a perpendicular neighbour (a corner) rather than straight from
 * behind, returns the side that feed comes from (for `drawBentArrow`); otherwise null. */
function cornerFeederSide(state: SimState, e: Entity & { dir: Direction }): Direction | null {
  const behindPos = { x: e.pos.x - DIR_DELTA[e.dir].x, y: e.pos.y - DIR_DELTA[e.dir].y };
  const behind = entityAt(state, behindPos);
  if (isBeltLike(behind) && behind.dir === e.dir) return null; // straight feeder — not a corner.
  for (const side of [0, 1, 2, 3] as Direction[]) {
    if (side === e.dir || side === oppositeDir(e.dir)) continue; // only the two perpendicular sides.
    const d = DIR_DELTA[side];
    const neighbor = entityAt(state, { x: e.pos.x + d.x, y: e.pos.y + d.y });
    if (isBeltLike(neighbor) && neighbor.dir === oppositeDir(side)) return side;
  }
  return null;
}

export interface GhostPreview {
  /** A placeholder entity (id is not meaningful) built purely to size/orient the preview. */
  entity: Entity;
  valid: boolean;
  /** Pole ghosts only: would placing here wire into an already-placed pole
   * (entities/power.ts's wouldPoleConnect)? Drives the blue/black outline. */
  connects?: boolean;
}

export interface RenderOptions {
  hover: Vec2 | null;
  selectedEntityId: number | null;
  bottleneckEntityId: number | null;
  ghost: GhostPreview | null;
  /** While drag-placing belts, the whole planned path (see editor.ts's
   * computeBeltDragPath) is previewed tile-by-tile instead of the single-tile
   * `ghost` above. */
  beltDragPreview?: { pos: Vec2; dir: Direction; valid: boolean }[] | null;
  /** When true, draws every pole's supply-area coverage (tinted by whether its
   * network is powered) and a line between every wired pole pair. */
  showPowerOverlay: boolean;
}

function drawEntityShape(ctx: CanvasRenderingContext2D, e: Entity, px: number, py: number, pw: number, ph: number): void {
  ctx.fillStyle = COLORS[e.kind];
  ctx.fillRect(px + 1, py + 1, pw - 2, ph - 2);
  if ("dir" in e) drawArrow(ctx, px + pw / 2, py + ph / 2, e.dir, TILE * 0.6);
  if (e.kind === "underground-belt") drawUndergroundRoleLabel(ctx, e.role, px, py);
}

/** Labels an underground belt as its entrance ("IN") or exit ("OUT") half — the two
 * halves are otherwise identical tiles, and only an entrance/exit pair (same tier, same
 * direction, within the tier's max gap) can tunnel items through at all, so this is the
 * only way to see which role a placed or about-to-be-placed tile has. */
function drawUndergroundRoleLabel(ctx: CanvasRenderingContext2D, role: "entrance" | "exit", px: number, py: number): void {
  ctx.fillStyle = "#fff";
  ctx.font = "bold 8px sans-serif";
  ctx.fillText(role === "entrance" ? "IN" : "OUT", px + 2, py + 9);
}

export function render(ctx: CanvasRenderingContext2D, state: SimState, opts: RenderOptions): void {
  const width = state.width * TILE;
  const height = state.height * TILE;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#f4f4f2";
  ctx.fillRect(0, 0, width, height);

  // Edge ring: only a pole whose footprint touches one of these tiles can draw power
  // for its whole network (see entities/power.ts's touchesEdge) — tint it so the rule
  // is visible instead of silently failing.
  ctx.fillStyle = "rgba(255, 193, 7, 0.16)";
  for (let x = 0; x < state.width; x++) {
    ctx.fillRect(x * TILE, 0, TILE, TILE);
    ctx.fillRect(x * TILE, (state.height - 1) * TILE, TILE, TILE);
  }
  for (let y = 0; y < state.height; y++) {
    ctx.fillRect(0, y * TILE, TILE, TILE);
    ctx.fillRect((state.width - 1) * TILE, y * TILE, TILE, TILE);
  }

  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= state.width; x++) {
    ctx.beginPath();
    ctx.moveTo(x * TILE + 0.5, 0);
    ctx.lineTo(x * TILE + 0.5, height);
    ctx.stroke();
  }
  for (let y = 0; y <= state.height; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * TILE + 0.5);
    ctx.lineTo(width, y * TILE + 0.5);
    ctx.stroke();
  }

  for (const e of state.entities.values()) {
    const { w, h } = footprintSize(e);
    const px = e.pos.x * TILE;
    const py = e.pos.y * TILE;
    const pw = w * TILE;
    const ph = h * TILE;

    ctx.fillStyle = COLORS[e.kind];
    ctx.fillRect(px + 1, py + 1, pw - 2, ph - 2);

    if (e.id === opts.bottleneckEntityId) {
      ctx.strokeStyle = "#ff3b3b";
      ctx.lineWidth = 3;
      ctx.strokeRect(px + 1.5, py + 1.5, pw - 3, ph - 3);
    } else if (e.id === opts.selectedEntityId) {
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);
    }

    if (e.kind === "belt" || e.kind === "underground-belt") {
      const cornerSide = cornerFeederSide(state, e);
      if (cornerSide !== null) drawBentArrow(ctx, px + pw / 2, py + ph / 2, cornerSide, e.dir, TILE * 0.6);
      else drawArrow(ctx, px + pw / 2, py + ph / 2, e.dir, TILE * 0.6);
      if (e.kind === "underground-belt") drawUndergroundRoleLabel(ctx, e.role, px, py);
    } else if ("dir" in e) {
      drawArrow(ctx, px + pw / 2, py + ph / 2, e.dir, TILE * 0.6);
    }

    if (e.kind === "belt" || e.kind === "underground-belt") {
      for (const lane of [0, 1] as const) {
        for (const item of e.lanes[lane]) {
          const along = item.pos;
          const across = lane === 0 ? 0.3 : 0.7;
          const forward = DIR_DELTA[e.dir];
          const sideways = { x: -forward.y, y: forward.x };
          const cx = px + TILE * (0.5 + forward.x * (along - 0.5) + sideways.x * (across - 0.5));
          const cy = py + TILE * (0.5 + forward.y * (along - 0.5) + sideways.y * (across - 0.5));
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(cx, cy, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    if (e.kind === "assembler") {
      ctx.fillStyle = "#fff";
      ctx.font = "10px sans-serif";
      ctx.fillText(e.recipeId ?? "(no recipe)", px + 4, py + ph - 20);
      ctx.fillRect(px + 4, py + ph - 12, (pw - 8) * e.progress, 6);
      ctx.strokeStyle = "#333";
      ctx.strokeRect(px + 4, py + ph - 12, pw - 8, 6);
    }

    if (e.kind === "item-sink") {
      ctx.fillStyle = "#fff";
      ctx.font = "10px sans-serif";
      ctx.fillText(String(e.totalCount), px + 4, py + ph / 2 + 4);
    }
    if (e.kind === "item-source") {
      ctx.fillStyle = "#fff";
      ctx.font = "9px sans-serif";
      ctx.fillText(e.item, px + 2, py + ph - 4);
    }
    if (e.kind === "chest") {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 9px sans-serif";
      ctx.fillText(e.tier[0].toUpperCase(), px + 2, py + 9);
      ctx.font = "9px sans-serif";
      ctx.fillText(`${chestSlotsUsed(e)}/${CHEST_SLOTS[e.tier]}`, px + 2, py + ph - 4);
    }
    if (e.kind === "inf-loader") {
      ctx.fillStyle = "#fff";
      ctx.font = "8px sans-serif";
      ctx.fillText(`L:${e.laneItems[0] ?? "-"}`, px + 2, py + ph / 2 - 2);
      ctx.fillText(`R:${e.laneItems[1] ?? "-"}`, px + 2, py + ph / 2 + 9);
    }
    if (e.kind === "inserter") {
      if (e.held) {
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(px + pw / 2, py + ph / 2, 5, 0, Math.PI * 2);
        ctx.fill();
        if (e.heldCount > 1) {
          ctx.fillStyle = "#111";
          ctx.font = "9px sans-serif";
          ctx.fillText(String(e.heldCount), px + pw / 2 + 6, py + ph / 2 - 6);
        }
      }
    }
  }

  if (opts.showPowerOverlay) {
    const poles = [...state.entities.values()].filter((e): e is Entity & { kind: "pole" } => e.kind === "pole");
    ctx.save();
    for (const p of poles) {
      const size = POLE_SPEC[p.tier].footprint;
      const cx = p.pos.x * TILE + (size * TILE) / 2;
      const cy = p.pos.y * TILE + (size * TILE) / 2;
      const half = (POLE_SPEC[p.tier].supplyArea * TILE) / 2;
      const powered = p.networkId !== null && state.poweredNetworks.has(p.networkId);
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = powered ? "#2ecc71" : "#8a8f98";
      ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(255, 200, 0, 0.85)";
    ctx.lineWidth = 2;
    for (const [a, b] of connectedPolePairs(state)) {
      const sizeA = POLE_SPEC[a.tier].footprint;
      const sizeB = POLE_SPEC[b.tier].footprint;
      const ax = a.pos.x * TILE + (sizeA * TILE) / 2;
      const ay = a.pos.y * TILE + (sizeA * TILE) / 2;
      const bx = b.pos.x * TILE + (sizeB * TILE) / 2;
      const by = b.pos.y * TILE + (sizeB * TILE) / 2;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (opts.hover) {
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 2;
    ctx.strokeRect(opts.hover.x * TILE + 1, opts.hover.y * TILE + 1, TILE - 2, TILE - 2);
  }

  if (opts.ghost) {
    const { entity, valid, connects } = opts.ghost;
    const { w, h } = footprintSize(entity);
    const px = entity.pos.x * TILE;
    const py = entity.pos.y * TILE;
    const pw = w * TILE;
    const ph = h * TILE;

    if (entity.kind === "pole") {
      // wiki.factorio.com/Substation, stable.wiki.factorio.com/Medium_electric_pole —
      // supplyArea is a square of that many tiles per side, centred on the pole.
      const supply = POLE_SPEC[entity.tier].supplyArea;
      const cx = px + pw / 2;
      const cy = py + ph / 2;
      const half = (supply * TILE) / 2;
      ctx.save();
      ctx.fillStyle = "#4d8ff0";
      ctx.globalAlpha = 0.15;
      ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = "#4d8ff0";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
      ctx.restore();

      if (valid) {
        ctx.save();
        ctx.strokeStyle = connects ? "#1e6fd9" : "#111";
        ctx.lineWidth = 3;
        ctx.setLineDash([]);
        ctx.strokeRect(px + 1.5, py + 1.5, pw - 3, ph - 3);
        ctx.restore();
      }
    }

    ctx.save();
    ctx.globalAlpha = 0.45;
    if (valid) {
      drawEntityShape(ctx, entity, px, py, pw, ph);
    } else {
      ctx.fillStyle = "#ff3b3b";
      ctx.fillRect(px + 1, py + 1, pw - 2, ph - 2);
      if ("dir" in entity) drawArrow(ctx, px + pw / 2, py + ph / 2, entity.dir, TILE * 0.6);
    }
    ctx.restore();
  }

  if (opts.beltDragPreview) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    for (const t of opts.beltDragPreview) {
      const px = t.pos.x * TILE;
      const py = t.pos.y * TILE;
      ctx.fillStyle = t.valid ? COLORS.belt : "#ff3b3b";
      ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
      if (t.valid) drawArrow(ctx, px + TILE / 2, py + TILE / 2, t.dir, TILE * 0.6);
    }
    ctx.restore();
  }
}
