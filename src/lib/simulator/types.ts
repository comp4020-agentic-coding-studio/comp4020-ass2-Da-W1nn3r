// Shared types for the factory simulator engine. Framework-free so the
// engine can be unit-tested (see spec/simulator.test.ts) without a browser.

export interface Vec2 {
  x: number;
  y: number;
}

/** 0 = north (up), 1 = east (right), 2 = south (down), 3 = west (left). */
export type Direction = 0 | 1 | 2 | 3;

export const DIR_DELTA: Record<Direction, Vec2> = {
  0: { x: 0, y: -1 },
  1: { x: 1, y: 0 },
  2: { x: 0, y: 1 },
  3: { x: -1, y: 0 },
};

export function addVec(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function rotateCW(d: Direction): Direction {
  return (((d + 1) % 4) as Direction);
}

export function oppositeDir(d: Direction): Direction {
  return (((d + 2) % 4) as Direction);
}

/** Tile directly in front of `pos` when facing `dir`. */
export function tileAhead(pos: Vec2, dir: Direction): Vec2 {
  return addVec(pos, DIR_DELTA[dir]);
}

/** Tile directly behind `pos` when facing `dir` (where flow would come from). */
export function tileBehind(pos: Vec2, dir: Direction): Vec2 {
  return addVec(pos, DIR_DELTA[oppositeDir(dir)]);
}

/** -1 if `dir2` is to the left of `dir1`, +1 if to the right, 0 if same/opposite. */
export function relativeSide(dir1: Direction, dir2: Direction): -1 | 0 | 1 {
  const diff = (dir2 - dir1 + 4) % 4;
  if (diff === 1) return 1; // dir2 points to dir1's right
  if (diff === 3) return -1; // dir2 points to dir1's left
  return 0;
}

export type ItemId = string;

export type BeltTier = "yellow" | "red" | "blue";
export type InserterType =
  | "burner"
  | "inserter"
  | "long-handed"
  | "fast"
  | "filter"
  | "stack";
export type PoleTier = "small" | "medium" | "big" | "substation";
export type AssemblerTier = "am1" | "am2" | "am3";
export type ChestTier = "wood" | "iron" | "steel";

export interface BeltItem {
  item: ItemId;
  /** Progress across the current tile, 0 (entry edge) to 1 (exit edge). */
  pos: number;
}

/** A belt has two lanes, left/right relative to its direction of travel. */
export type BeltLanes = [BeltItem[], BeltItem[]];

export interface BeltEntity {
  id: number;
  kind: "belt";
  pos: Vec2;
  dir: Direction;
  tier: BeltTier;
  lanes: BeltLanes;
}

export interface UndergroundBeltEntity {
  id: number;
  kind: "underground-belt";
  pos: Vec2;
  dir: Direction;
  tier: BeltTier;
  /** "entrance" faces its `dir` into the ground; "exit" faces `dir` out of the ground. */
  role: "entrance" | "exit";
  lanes: BeltLanes;
  /** Items in transit underground, keyed by lane, holding distance remaining in tiles. */
  tunnel: [{ item: ItemId; remaining: number }[], { item: ItemId; remaining: number }[]];
  /** Id of the paired underground belt this one connects to, once resolved. */
  partnerId: number | null;
}

export interface SplitterEntity {
  id: number;
  kind: "splitter";
  /** Position of the first (left, relative to dir) half-tile; the second half is one tile to the right of dir. */
  pos: Vec2;
  dir: Direction;
  tier: BeltTier;
  filter: ItemId | null;
  /** Which side the filtered item goes to when `filter` is set. */
  filterSide: "left" | "right";
  inputPriority: "left" | "right" | "none";
  outputPriority: "left" | "right" | "none";
  /** Balance-mode (no filter, no priority) round-robin: which side each lane sends its
   * next item to, alternating every successful send so the split stays 1:1 over time
   * instead of always favouring whichever side happens to have more room right now. */
  nextOutput: ["left" | "right", "left" | "right"];
  lanesLeft: BeltLanes;
  lanesRight: BeltLanes;
}

export interface InserterEntity {
  id: number;
  kind: "inserter";
  pos: Vec2;
  dir: Direction;
  type: InserterType;
  filter: ItemId | null;
  /** Ticks remaining in the current swing; null when idle (waiting for a pickup). */
  swingTicksRemaining: number | null;
  swingTotalTicks: number;
  /** Item currently held mid-swing. */
  held: ItemId | null;
  /** How many of `held` this swing is carrying (stack inserters may carry more than one). */
  heldCount: number;
}

export interface AssemblerEntity {
  id: number;
  kind: "assembler";
  /** Top-left tile of its 3x3 footprint. */
  pos: Vec2;
  dir: Direction;
  tier: AssemblerTier;
  recipeId: string | null;
  progress: number; // 0..1
  inputBuffer: Record<ItemId, number>;
  outputBuffer: Record<ItemId, number>;
  poweredThisTick: boolean;
}

export interface PoleEntity {
  id: number;
  kind: "pole";
  pos: Vec2;
  tier: PoleTier;
  /** Resolved once per topology change; all poles wired together share a networkId. */
  networkId: number | null;
}

export interface ItemSourceEntity {
  id: number;
  kind: "item-source";
  pos: Vec2;
  dir: Direction;
  item: ItemId;
}

export interface ItemSinkEntity {
  id: number;
  kind: "item-sink";
  pos: Vec2;
  dir: Direction;
  totalCount: number;
  /** Ring buffer of {tick, count} samples used to compute a rolling items/min rate. */
  history: { tick: number; total: number }[];
}

export interface ChestEntity {
  id: number;
  kind: "chest";
  pos: Vec2;
  tier: ChestTier;
  /** Item counts, keyed by item id; a key is removed once its count reaches 0. */
  inventory: Record<ItemId, number>;
}

/** Testing/debug utility with no real-game counterpart: independently saturates each of a
 * belt's two lanes with a fixed item every tick (or leaves a lane empty when null). See
 * entities/inf-loader.ts's header for why this isn't modelled as an item-source variant. */
export interface InfLoaderEntity {
  id: number;
  kind: "inf-loader";
  pos: Vec2;
  dir: Direction;
  laneItems: [ItemId | null, ItemId | null];
}

export type Entity =
  | BeltEntity
  | UndergroundBeltEntity
  | SplitterEntity
  | InserterEntity
  | AssemblerEntity
  | PoleEntity
  | ItemSourceEntity
  | ItemSinkEntity
  | ChestEntity
  | InfLoaderEntity;

export type EntityKind = Entity["kind"];

/** Per-entity utilisation stats gathered during a bottleneck analysis run. */
export interface UtilisationStats {
  activeTicks: number;
  starvedTicks: number;
  blockedTicks: number;
}

export interface BottleneckResult {
  entityId: number | null;
  utilisation: number; // 0..1, share of ticks spent active
  reason: string;
  throughputPerMinute: number;
}
