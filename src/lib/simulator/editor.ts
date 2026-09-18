// Pointer/keyboard editing: palette selection, placement, rotation,
// deletion, and the current selection used to drive the inspector panel.

import { ITEM_CATALOG } from "./constants";
import { detectUndergroundRole } from "./entities/belt";
import { canPlace, nextEntityId, placeEntity, removeEntity, tileKey, type SimState } from "./grid";
import { TILE } from "./render";
import type {
  AssemblerTier,
  BeltTier,
  ChestTier,
  Direction,
  Entity,
  EntityKind,
  InserterType,
  PoleTier,
  Vec2,
} from "./types";
import { rotateCW } from "./types";

export interface PaletteSpec {
  id: string;
  label: string;
  group: string;
  kind: EntityKind;
  tier?: BeltTier | PoleTier | AssemblerTier | ChestTier;
  type?: InserterType;
}

export const PALETTE: PaletteSpec[] = [
  { id: "belt-yellow", label: "Yellow belt", group: "Belts", kind: "belt", tier: "yellow" },
  { id: "belt-red", label: "Red belt", group: "Belts", kind: "belt", tier: "red" },
  { id: "belt-blue", label: "Blue belt", group: "Belts", kind: "belt", tier: "blue" },
  { id: "ug-belt-yellow", label: "Yellow underground belt", group: "Underground belts", kind: "underground-belt", tier: "yellow" },
  { id: "ug-belt-red", label: "Red underground belt", group: "Underground belts", kind: "underground-belt", tier: "red" },
  { id: "ug-belt-blue", label: "Blue underground belt", group: "Underground belts", kind: "underground-belt", tier: "blue" },
  { id: "splitter-yellow", label: "Yellow splitter", group: "Splitters", kind: "splitter", tier: "yellow" },
  { id: "splitter-red", label: "Red splitter", group: "Splitters", kind: "splitter", tier: "red" },
  { id: "splitter-blue", label: "Blue splitter", group: "Splitters", kind: "splitter", tier: "blue" },
  { id: "inserter-basic", label: "Inserter", group: "Inserters", kind: "inserter", type: "inserter" },
  { id: "inserter-long", label: "Long-handed inserter", group: "Inserters", kind: "inserter", type: "long-handed" },
  { id: "inserter-fast", label: "Fast inserter", group: "Inserters", kind: "inserter", type: "fast" },
  { id: "inserter-stack", label: "Stack inserter", group: "Inserters", kind: "inserter", type: "stack" },
  { id: "assembler-1", label: "Assembling machine 1", group: "Assemblers", kind: "assembler", tier: "am1" },
  { id: "assembler-2", label: "Assembling machine 2", group: "Assemblers", kind: "assembler", tier: "am2" },
  { id: "assembler-3", label: "Assembling machine 3", group: "Assemblers", kind: "assembler", tier: "am3" },
  { id: "pole-small", label: "Small pole", group: "Power poles", kind: "pole", tier: "small" },
  { id: "pole-medium", label: "Medium pole", group: "Power poles", kind: "pole", tier: "medium" },
  { id: "pole-big", label: "Big pole", group: "Power poles", kind: "pole", tier: "big" },
  { id: "pole-substation", label: "Substation", group: "Power poles", kind: "pole", tier: "substation" },
  { id: "item-source", label: "Item source (infinite)", group: "Sources & sinks", kind: "item-source" },
  { id: "item-sink", label: "Item sink (measures throughput)", group: "Sources & sinks", kind: "item-sink" },
  { id: "chest-wood", label: "Wooden chest", group: "Chests", kind: "chest", tier: "wood" },
  { id: "chest-iron", label: "Iron chest", group: "Chests", kind: "chest", tier: "iron" },
  { id: "chest-steel", label: "Steel chest", group: "Chests", kind: "chest", tier: "steel" },
  { id: "inf-loader", label: "Infinite loader (testing)", group: "Loaders", kind: "inf-loader" },
  { id: "void-chest", label: "Void chest (desaturates + balance check)", group: "Loaders", kind: "void-chest" },
];

export type Tool = { mode: "place"; spec: PaletteSpec } | { mode: "select" } | { mode: "delete" };

export interface EditorState {
  tool: Tool;
  dir: Direction;
  undergroundRole: "entrance" | "exit";
  hover: Vec2 | null;
  selectedEntityId: number | null;
}

export function createEditorState(): EditorState {
  return { tool: { mode: "select" }, dir: 1, undergroundRole: "entrance", hover: null, selectedEntityId: null };
}

export function pointerToTile(canvas: HTMLCanvasElement, evt: { clientX: number; clientY: number }): Vec2 {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: Math.floor(((evt.clientX - rect.left) * scaleX) / TILE),
    y: Math.floor(((evt.clientY - rect.top) * scaleY) / TILE),
  };
}

export function buildEntity(state: SimState, spec: PaletteSpec, pos: Vec2, dir: Direction, ugRole: "entrance" | "exit"): Entity {
  return buildEntityWithId(state, nextEntityId(state), spec, pos, dir, ugRole);
}

/** Builds the same entity shape as `buildEntity` but with a fixed placeholder id,
 * so it never consumes `state.nextId`. Used for the placement ghost preview, which
 * is rebuilt every frame purely to check `canPlace`/`footprintTiles` — neither of
 * which reads `entity.id`. */
export function buildGhostEntity(state: SimState, spec: PaletteSpec, pos: Vec2, dir: Direction, ugRole: "entrance" | "exit"): Entity {
  return buildEntityWithId(state, -1, spec, pos, dir, ugRole);
}

function buildEntityWithId(
  state: SimState,
  id: number,
  spec: PaletteSpec,
  pos: Vec2,
  dir: Direction,
  ugRole: "entrance" | "exit",
): Entity {
  switch (spec.kind) {
    case "belt":
      return { id, kind: "belt", pos, dir, tier: spec.tier as BeltTier, lanes: [[], []] };
    case "underground-belt": {
      const tier = spec.tier as BeltTier;
      // Auto-detects entrance vs. exit from any unpaired, same-tier, same-facing
      // underground belt already in range, matching the real game's placement
      // snapping; only falls back to the editor's manually-toggled role when
      // placing a fresh, unpaired end (see detectUndergroundRole in entities/belt.ts).
      const role = detectUndergroundRole(state, pos, dir, tier, ugRole);
      return {
        id,
        kind: "underground-belt",
        pos,
        dir,
        tier,
        role,
        lanes: [[], []],
        tunnel: [[], []],
        partnerId: null,
      };
    }
    case "splitter":
      return {
        id,
        kind: "splitter",
        pos,
        dir,
        tier: spec.tier as BeltTier,
        filter: null,
        filterSide: "left",
        inputPriority: "none",
        outputPriority: "none",
        nextOutput: ["left", "left"],
        lanesLeft: [[], []],
        lanesRight: [[], []],
      };
    case "inserter":
      return {
        id,
        kind: "inserter",
        pos,
        dir,
        type: spec.type as InserterType,
        filter: null,
        swingTicksRemaining: null,
        swingTotalTicks: 0,
        held: null,
        heldCount: 0,
      };
    case "assembler":
      return {
        id,
        kind: "assembler",
        pos,
        dir,
        tier: spec.tier as AssemblerTier,
        recipeId: null,
        progress: 0,
        inputBuffer: {},
        outputBuffer: {},
        poweredThisTick: false,
      };
    case "pole":
      return { id, kind: "pole", pos, tier: spec.tier as PoleTier, networkId: null };
    case "item-source":
      return { id, kind: "item-source", pos, dir, item: ITEM_CATALOG[0] };
    case "item-sink":
      return { id, kind: "item-sink", pos, dir, totalCount: 0, history: [] };
    case "chest":
      return { id, kind: "chest", pos, tier: spec.tier as ChestTier, inventory: {} };
    case "inf-loader":
      return { id, kind: "inf-loader", pos, dir, laneItems: [null, null] };
    case "void-chest":
      return { id, kind: "void-chest", pos, dir, leftCount: 0, rightCount: 0 };
  }
}

/** Handle a canvas click at `pos` given the current tool. Returns true if it changed the layout. */
export function handleClick(state: SimState, editor: EditorState, pos: Vec2): boolean {
  if (editor.tool.mode === "select") {
    editor.selectedEntityId = state.occupancy.get(tileKey(pos)) ?? null;
    return false;
  }
  if (editor.tool.mode === "delete") {
    const id = state.occupancy.get(tileKey(pos));
    if (id === undefined) return false;
    removeEntity(state, id);
    if (editor.selectedEntityId === id) editor.selectedEntityId = null;
    return true;
  }
  const entity = buildEntity(state, editor.tool.spec, pos, editor.dir, editor.undergroundRole);
  if (!canPlace(state, entity)) return false;
  placeEntity(state, entity);
  editor.selectedEntityId = entity.id;
  return true;
}

export function rotate(editor: EditorState): void {
  editor.dir = rotateCW(editor.dir);
}

/** Toggles which end of an underground-belt pair the next placement creates. There is
 * no way to place a `role: "exit"` underground belt without this — `undergroundRole`
 * starts at `"entrance"` and nothing else in the editor ever mutates it, so without a
 * way to flip it every underground belt placed is an entrance and none can ever pair. */
export function toggleUndergroundRole(editor: EditorState): void {
  editor.undergroundRole = editor.undergroundRole === "entrance" ? "exit" : "entrance";
}

export interface BeltDragTile {
  pos: Vec2;
  dir: Direction;
}

function horizontalRun(fromX: number, toX: number, y: number): BeltDragTile[] {
  const dir: Direction = toX >= fromX ? 1 : 3;
  const step = toX >= fromX ? 1 : -1;
  const out: BeltDragTile[] = [];
  for (let x = fromX; ; x += step) {
    out.push({ pos: { x, y }, dir });
    if (x === toX) break;
  }
  return out;
}

function verticalRun(fromY: number, toY: number, x: number): BeltDragTile[] {
  const dir: Direction = toY >= fromY ? 2 : 0;
  const step = toY >= fromY ? 1 : -1;
  const out: BeltDragTile[] = [];
  for (let y = fromY; ; y += step) {
    out.push({ pos: { x, y }, dir });
    if (y === toY) break;
  }
  return out;
}

/** Computes an L-shaped (or straight) belt path from `start` to `end`, walking one axis
 * fully (like a Manhattan-distance step count) before turning onto the other — the same
 * "walk x, then walk y" decomposition a manhattan-distance calculation uses, just kept as
 * a tile list instead of collapsed to a sum. `bendFirst` picks which axis's run leaves
 * `start`; the corner tile always belongs to the *second* run, since that's the direction
 * it actually feeds out toward (see render.ts's cornerFeederSide for how a corner is drawn
 * from that same rule). When start and end share an axis there's only one straight run and
 * no bend to choose. When start === end there's no drag to walk at all; callers should
 * place a single tile using whatever direction was current at mouse-down instead of
 * calling this (the direction returned here for that case is an arbitrary placeholder). */
export function computeBeltDragPath(start: Vec2, end: Vec2, bendFirst: "horizontal" | "vertical"): BeltDragTile[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return [{ pos: start, dir: bendFirst === "horizontal" ? 1 : 2 }];
  if (dy === 0) return horizontalRun(start.x, end.x, start.y);
  if (dx === 0) return verticalRun(start.y, end.y, start.x);

  if (bendFirst === "horizontal") {
    const run1 = horizontalRun(start.x, end.x, start.y).slice(0, -1);
    const run2 = verticalRun(start.y, end.y, end.x);
    return [...run1, ...run2];
  }
  const run1 = verticalRun(start.y, end.y, start.x).slice(0, -1);
  const run2 = horizontalRun(start.x, end.x, end.y);
  return [...run1, ...run2];
}
