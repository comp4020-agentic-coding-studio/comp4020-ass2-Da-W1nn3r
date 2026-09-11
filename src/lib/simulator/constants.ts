// Every numeric constant here was checked against the Factorio wiki or forums
// before being encoded (see the "Verified mechanics and constants" table in
// the implementation plan) — not recalled from memory. Sources are noted
// inline.

import type { AssemblerTier, BeltTier, ChestTier, InserterType, PoleTier } from "./types";

export const TICKS_PER_SECOND = 60;

// wiki.factorio.com/Transport_belts/Physics — items/second per lane, both
// lanes combined is double this.
export const BELT_ITEMS_PER_SECOND_PER_LANE: Record<BeltTier, number> = {
  yellow: 7.5,
  red: 15,
  blue: 22.5,
};

// A lane holds at most 4 items per tile when fully compressed (density from
// the same wiki page's throughput formula), so the minimum gap between two
// items on a lane is 1/4 tile.
export const BELT_MIN_ITEM_GAP = 0.25;

// tiles/second per lane = (items/second/lane) / (items/tile density)
export function beltLaneSpeedTilesPerSecond(tier: BeltTier): number {
  return BELT_ITEMS_PER_SECOND_PER_LANE[tier] / 4;
}

// wiki.factorio.com/Underground_belt — max gap in tiles for each tier
// (base game; Space Age's 4th tier is out of scope).
export const UNDERGROUND_BELT_MAX_GAP: Record<BeltTier, number> = {
  yellow: 4,
  red: 6,
  blue: 8,
};

// Ticks for one full pickup-swing-drop cycle at 60 ticks/second, from
// forum-measured cycle times (forums.factorio.com/viewtopic.php?t=64828),
// cross-checked against wiki.factorio.com/Inserters. Filter/stack share the
// fast inserter's arm.
export const INSERTER_CYCLE_TICKS: Record<InserterType, number> = {
  burner: 102,
  inserter: 72,
  "long-handed": 52,
  fast: 26,
  filter: 26,
  stack: 26,
};

// wiki.factorio.com/Inserters — pickup/drop reach in tiles from the
// inserter's own tile.
export const INSERTER_REACH: Record<InserterType, number> = {
  burner: 1,
  inserter: 1,
  "long-handed": 2,
  fast: 1,
  filter: 1,
  stack: 1,
};

// wiki.factorio.com/Inserters — picking from a stalled/compressed belt's
// near lane is faster than the far lane because the arm's swing arc is
// shorter; a moving item gets tracked ("windmilled") at the standard cycle
// time regardless of lane. 8.7% measured for a fast-class inserter
// (forums.factorio.com/viewtopic.php?t=26645); applied uniformly here.
export const NEAR_LANE_SPEED_BONUS = 0.087;

// wiki.factorio.com/Stack_inserter — stack capacity is base-capacity-plus-a
// research-scaled bonus; this simulator models no tech tree (same scope cut
// as modules/quality elsewhere), so a fixed representative mid-game value
// stands in for the researched bonus. Every other inserter type moves items
// one at a time.
export const INSERTER_STACK_SIZE: Record<InserterType, number> = {
  burner: 1,
  inserter: 1,
  "long-handed": 1,
  fast: 1,
  filter: 1,
  stack: 4,
};

export const ASSEMBLER_SPEC: Record<AssemblerTier, { craftingSpeed: number; moduleSlots: number }> = {
  // wiki.factorio.com/Assembling_machine_1/2/3
  am1: { craftingSpeed: 0.5, moduleSlots: 0 },
  am2: { craftingSpeed: 0.75, moduleSlots: 2 },
  am3: { craftingSpeed: 1.25, moduleSlots: 4 },
};

export const ASSEMBLER_FOOTPRINT = 3; // tiles, all three tiers

// Scope-cut stand-in for the real game's fixed per-recipe input/output inventory
// slots — not itself a sourced number, just enough headroom (in multiples of one
// craft's worth) that a single craft cycle never blocks on rounding. Used by
// assembler.ts's output-room check and its ingredientInputCap helper, which
// inserter.ts uses both to cap what it drops into an input buffer and to decide
// what's still worth picking up in the first place (see inserter.ts's
// destinationRoomFor — an inserter won't grab an ingredient the buffer is
// already full of).
export const ASSEMBLER_BUFFER_CAP_MULTIPLIER = 5;

export interface Recipe {
  id: string;
  name: string;
  craftTimeSeconds: number;
  ingredients: { item: string; amount: number }[];
  results: { item: string; amount: number }[];
}

// Every ingredient referenced below is itself either a raw item (iron-plate,
// copper-plate — sourced only from an item-source, no recipe of its own,
// matching this simulator's scope cut of not modelling mining/smelting) or
// has its own recipe in this same list, so the tree bottoms out cleanly.
// Amounts/times verified against each item's wiki.factorio.com recipe
// infobox, not recalled from memory:
//   - Copper_cable, Transport_belt, Inserter, Automation_science_pack,
//     Logistic_science_pack (fetched directly).
// The game's real electric-engine-unit recipe requires lubricant (a fluid)
// as an ingredient; since this simulator no longer models fluids at all, that
// recipe (and the engine-unit it alone consumed) has been dropped rather than
// faking a fluid-free substitute — the same "don't fabricate, cut the scope"
// approach as the near/far lane ambiguity cut in inserter.ts.
export const RECIPES: Recipe[] = [
  {
    id: "iron-gear-wheel",
    name: "Iron gear wheel",
    craftTimeSeconds: 0.5,
    ingredients: [{ item: "iron-plate", amount: 2 }],
    results: [{ item: "iron-gear-wheel", amount: 1 }],
  },
  {
    id: "copper-cable",
    name: "Copper cable",
    craftTimeSeconds: 0.5,
    ingredients: [{ item: "copper-plate", amount: 1 }],
    results: [{ item: "copper-cable", amount: 2 }],
  },
  {
    id: "electronic-circuit",
    name: "Electronic circuit",
    craftTimeSeconds: 0.5,
    ingredients: [
      { item: "iron-plate", amount: 1 },
      { item: "copper-cable", amount: 3 },
    ],
    results: [{ item: "electronic-circuit", amount: 1 }],
  },
  {
    id: "transport-belt",
    name: "Transport belt",
    craftTimeSeconds: 0.5,
    ingredients: [
      { item: "iron-gear-wheel", amount: 1 },
      { item: "iron-plate", amount: 1 },
    ],
    results: [{ item: "transport-belt", amount: 2 }],
  },
  {
    id: "inserter",
    name: "Inserter",
    craftTimeSeconds: 0.5,
    ingredients: [
      { item: "electronic-circuit", amount: 1 },
      { item: "iron-gear-wheel", amount: 1 },
      { item: "iron-plate", amount: 1 },
    ],
    results: [{ item: "inserter", amount: 1 }],
  },
  {
    id: "automation-science-pack",
    name: "Automation science pack",
    craftTimeSeconds: 5,
    ingredients: [
      { item: "copper-plate", amount: 1 },
      { item: "iron-gear-wheel", amount: 1 },
    ],
    results: [{ item: "automation-science-pack", amount: 1 }],
  },
  {
    id: "logistic-science-pack",
    name: "Logistic science pack",
    craftTimeSeconds: 6,
    ingredients: [
      { item: "inserter", amount: 1 },
      { item: "transport-belt", amount: 1 },
    ],
    results: [{ item: "logistic-science-pack", amount: 1 }],
  },
];

export const ITEM_CATALOG = [
  "iron-plate",
  "copper-plate",
  "copper-cable",
  "iron-gear-wheel",
  "electronic-circuit",
  "transport-belt",
  "inserter",
  "automation-science-pack",
  "logistic-science-pack",
];

// wiki.factorio.com/Substation, stable.wiki.factorio.com/Medium_electric_pole
export const POLE_SPEC: Record<PoleTier, { wireReach: number; supplyArea: number; footprint: number }> = {
  small: { wireReach: 7.5, supplyArea: 5, footprint: 1 },
  medium: { wireReach: 9, supplyArea: 7, footprint: 1 },
  big: { wireReach: 30, supplyArea: 4, footprint: 2 },
  substation: { wireReach: 18, supplyArea: 18, footprint: 2 },
};

// wiki.factorio.com/Chests — inventory size in slots. Logistics chests (active/passive
// provider, storage, requester, buffer) also exist but are out of scope: this simulator
// has no bot/logistics-network model for them to plug into.
export const CHEST_SLOTS: Record<ChestTier, number> = {
  wood: 16,
  iron: 32,
  steel: 48,
};

// Stack size per item, from each item's own wiki.factorio.com infobox — needed to convert
// a chest's slot count (above) into an actual item cap, since a chest slot holds up to one
// full stack of whatever item occupies it.
export const ITEM_STACK_SIZE: Record<string, number> = {
  "iron-plate": 100,
  "copper-plate": 100,
  "copper-cable": 200,
  "iron-gear-wheel": 100,
  "electronic-circuit": 200,
  "transport-belt": 100,
  inserter: 50,
  "automation-science-pack": 200,
  "logistic-science-pack": 200,
};
