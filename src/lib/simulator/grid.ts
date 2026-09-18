// Tile occupancy, footprints, and the top-level simulation state container.

import { ASSEMBLER_FOOTPRINT, POLE_SPEC } from "./constants";
import type { Entity, UtilisationStats, Vec2 } from "./types";

export function tileKey(pos: Vec2): string {
  return `${pos.x},${pos.y}`;
}

/** Every tile an entity occupies, top-left anchored at `entity.pos`. */
export function footprintTiles(entity: Entity): Vec2[] {
  const { x, y } = entity.pos;
  switch (entity.kind) {
    case "assembler": {
      const tiles: Vec2[] = [];
      for (let dx = 0; dx < ASSEMBLER_FOOTPRINT; dx++) {
        for (let dy = 0; dy < ASSEMBLER_FOOTPRINT; dy++) {
          tiles.push({ x: x + dx, y: y + dy });
        }
      }
      return tiles;
    }
    case "pole": {
      const size = POLE_SPEC[entity.tier].footprint;
      const tiles: Vec2[] = [];
      for (let dx = 0; dx < size; dx++) {
        for (let dy = 0; dy < size; dy++) {
          tiles.push({ x: x + dx, y: y + dy });
        }
      }
      return tiles;
    }
    case "splitter": {
      // Two tiles wide, perpendicular to its direction of travel.
      const perpendicular = entity.dir % 2 === 0 ? { x: 1, y: 0 } : { x: 0, y: 1 };
      return [{ x, y }, { x: x + perpendicular.x, y: y + perpendicular.y }];
    }
    default:
      return [{ x, y }];
  }
}

export interface SimState {
  width: number;
  height: number;
  entities: Map<number, Entity>;
  /** Tile key -> entity id. Every tile of a multi-tile entity gets an entry. */
  occupancy: Map<string, number>;
  nextId: number;
  tick: number;
  /** Recomputed lazily; set true whenever placement/removal changes topology. */
  powerDirty: boolean;
  beltDirty: boolean;
  /** networkId -> whether that pole network currently reaches the map edge (power.ts). */
  poweredNetworks: Set<number>;
  /** entityId -> active/starved/blocked tick counts, accumulated by entity modules for bottleneck.ts. Cleared per analysis run. */
  stats: Map<number, UtilisationStats>;
}

export function createState(width = 48, height = 32): SimState {
  return {
    width,
    height,
    entities: new Map(),
    occupancy: new Map(),
    nextId: 1,
    tick: 0,
    powerDirty: true,
    beltDirty: true,
    poweredNetworks: new Set(),
    stats: new Map(),
  };
}

export type StatusKind = "active" | "starved" | "blocked";

/** Record one tick's outcome for `id`, used by bottleneck.ts to find the constraint after a run. */
export function recordStat(state: SimState, id: number, status: StatusKind): void {
  let s = state.stats.get(id);
  if (!s) {
    s = { activeTicks: 0, starvedTicks: 0, blockedTicks: 0 };
    state.stats.set(id, s);
  }
  if (status === "active") s.activeTicks += 1;
  else if (status === "starved") s.starvedTicks += 1;
  else s.blockedTicks += 1;
}

/** Simple union-find used by power network resolution. */
export class DisjointSet {
  private parent = new Map<number, number>();

  find(x: number): number {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export function inBounds(state: SimState, pos: Vec2): boolean {
  return pos.x >= 0 && pos.y >= 0 && pos.x < state.width && pos.y < state.height;
}

export function canPlace(state: SimState, entity: Entity): boolean {
  return footprintTiles(entity).every(
    (tile) => inBounds(state, tile) && !state.occupancy.has(tileKey(tile)),
  );
}

/** A void chest's left/right balance reading only describes the layout as it stood
 * since the last edit — resetting it on every placement/removal (rather than only on
 * an explicit run reset, like clearAllItems) keeps it from reporting a balance verdict
 * that was measured against a since-changed feed. */
function resetVoidChestBalances(state: SimState): void {
  for (const e of state.entities.values()) {
    if (e.kind !== "void-chest") continue;
    e.leftCount = 0;
    e.rightCount = 0;
  }
}

export function placeEntity(state: SimState, entity: Entity): boolean {
  if (!canPlace(state, entity)) return false;
  state.entities.set(entity.id, entity);
  for (const tile of footprintTiles(entity)) {
    state.occupancy.set(tileKey(tile), entity.id);
  }
  state.powerDirty = true;
  state.beltDirty = true;
  resetVoidChestBalances(state);
  return true;
}

export function removeEntity(state: SimState, id: number): void {
  const entity = state.entities.get(id);
  if (!entity) return;
  for (const tile of footprintTiles(entity)) {
    state.occupancy.delete(tileKey(tile));
  }
  state.entities.delete(id);
  state.powerDirty = true;
  state.beltDirty = true;
  resetVoidChestBalances(state);
}

export function entityAt(state: SimState, pos: Vec2): Entity | undefined {
  const id = state.occupancy.get(tileKey(pos));
  return id === undefined ? undefined : state.entities.get(id);
}

/** Empties every item currently in transit or storage — belt/underground-belt lanes and
 * tunnels, splitter lanes, inserter hands (and their mid-swing state, since a swing is only
 * ever "carrying" the held item it's now lost), assembler input/output buffers, chest
 * inventories, the item-sink counter/history, and the void-chest left/right drain
 * counts — without touching placed entities, their configuration (recipes, filters,
 * tiers, directions, priorities), or power/belt topology. Leaves the layout exactly as
 * built, just empty of items, e.g. to reset a run without re-placing everything. */
export function clearAllItems(state: SimState): void {
  for (const entity of state.entities.values()) {
    switch (entity.kind) {
      case "belt":
        entity.lanes = [[], []];
        break;
      case "underground-belt":
        entity.lanes = [[], []];
        entity.tunnel = [[], []];
        break;
      case "splitter":
        entity.lanesLeft = [[], []];
        entity.lanesRight = [[], []];
        break;
      case "inserter":
        entity.held = null;
        entity.heldCount = 0;
        entity.swingTicksRemaining = null;
        entity.swingTotalTicks = 0;
        break;
      case "assembler":
        entity.inputBuffer = {};
        entity.outputBuffer = {};
        break;
      case "chest":
        entity.inventory = {};
        break;
      case "item-sink":
        entity.totalCount = 0;
        entity.history = [];
        break;
      case "void-chest":
        entity.leftCount = 0;
        entity.rightCount = 0;
        break;
      default:
        break;
    }
  }
}

export function nextEntityId(state: SimState): number {
  return state.nextId++;
}
