// Pure-logic tests for the factory simulator engine (src/lib/simulator/**).
// No build or browser needed — these exercise the tick loop directly.

import { describe, expect, it } from "vitest";
import {
  BELT_ITEMS_PER_SECOND_PER_LANE,
  BELT_MIN_ITEM_GAP,
  CHEST_SLOTS,
  INSERTER_CYCLE_TICKS,
  INSERTER_STACK_SIZE,
  ITEM_STACK_SIZE,
  TICKS_PER_SECOND,
  UNDERGROUND_BELT_MAX_GAP,
} from "../src/lib/simulator/constants";
import {
  computeBeltDragPath,
  createEditorState,
  handleClick,
  PALETTE,
  toggleUndergroundRole,
} from "../src/lib/simulator/editor";
import { clearAllItems, createState, placeEntity, removeEntity, type SimState } from "../src/lib/simulator/grid";
import { tick, tickMany } from "../src/lib/simulator/simulate";
import { runBottleneckAnalysis } from "../src/lib/simulator/bottleneck";
import { chestInsert, chestTake } from "../src/lib/simulator/entities/chest";
import { wouldPoleConnect } from "../src/lib/simulator/entities/power";
import { voidChestBalance } from "../src/lib/simulator/entities/void-chest";
import type { ChestEntity, Entity, PoleEntity } from "../src/lib/simulator/types";

describe("verified mechanic constants", () => {
  it("matches the belt throughput table (items/second per lane)", () => {
    expect(BELT_ITEMS_PER_SECOND_PER_LANE.yellow).toBe(7.5);
    expect(BELT_ITEMS_PER_SECOND_PER_LANE.red).toBe(15);
    expect(BELT_ITEMS_PER_SECOND_PER_LANE.blue).toBe(22.5);
  });

  it("matches the underground belt max-gap table (tiles)", () => {
    expect(UNDERGROUND_BELT_MAX_GAP.yellow).toBe(4);
    expect(UNDERGROUND_BELT_MAX_GAP.red).toBe(6);
    expect(UNDERGROUND_BELT_MAX_GAP.blue).toBe(8);
  });

  it("matches the inserter cycle-time table (ticks at 60/s)", () => {
    expect(INSERTER_CYCLE_TICKS.burner).toBe(102);
    expect(INSERTER_CYCLE_TICKS.inserter).toBe(72);
    expect(INSERTER_CYCLE_TICKS["long-handed"]).toBe(52);
    expect(INSERTER_CYCLE_TICKS.fast).toBe(26);
    expect(INSERTER_CYCLE_TICKS.stack).toBe(26);
  });

  it("matches wiki.factorio.com/Chests' inventory slot counts", () => {
    expect(CHEST_SLOTS.wood).toBe(16);
    expect(CHEST_SLOTS.iron).toBe(32);
    expect(CHEST_SLOTS.steel).toBe(48);
  });

  it("matches each item's wiki.factorio.com stack size", () => {
    expect(ITEM_STACK_SIZE["iron-plate"]).toBe(100);
    expect(ITEM_STACK_SIZE["copper-plate"]).toBe(100);
    expect(ITEM_STACK_SIZE["copper-cable"]).toBe(200);
    expect(ITEM_STACK_SIZE["iron-gear-wheel"]).toBe(100);
    expect(ITEM_STACK_SIZE["electronic-circuit"]).toBe(200);
    expect(ITEM_STACK_SIZE["transport-belt"]).toBe(100);
    expect(ITEM_STACK_SIZE.inserter).toBe(50);
    expect(ITEM_STACK_SIZE["automation-science-pack"]).toBe(200);
    expect(ITEM_STACK_SIZE["logistic-science-pack"]).toBe(200);
  });
});

describe("belt drag-placement path (computeBeltDragPath)", () => {
  it("walks a single straight horizontal run with no bend", () => {
    const path = computeBeltDragPath({ x: 0, y: 0 }, { x: 3, y: 0 }, "horizontal");
    expect(path).toEqual([
      { pos: { x: 0, y: 0 }, dir: 1 },
      { pos: { x: 1, y: 0 }, dir: 1 },
      { pos: { x: 2, y: 0 }, dir: 1 },
      { pos: { x: 3, y: 0 }, dir: 1 },
    ]);
  });

  it("walks a single straight vertical run regardless of bendFirst", () => {
    const path = computeBeltDragPath({ x: 2, y: 5 }, { x: 2, y: 2 }, "horizontal");
    expect(path).toEqual([
      { pos: { x: 2, y: 5 }, dir: 0 },
      { pos: { x: 2, y: 4 }, dir: 0 },
      { pos: { x: 2, y: 3 }, dir: 0 },
      { pos: { x: 2, y: 2 }, dir: 0 },
    ]);
  });

  it("bends horizontal-then-vertical when bendFirst is 'horizontal', corner taking the vertical leg's direction", () => {
    const path = computeBeltDragPath({ x: 0, y: 0 }, { x: 2, y: 2 }, "horizontal");
    expect(path).toEqual([
      { pos: { x: 0, y: 0 }, dir: 1 }, // east leg (corner excluded — it belongs to the vertical leg)
      { pos: { x: 1, y: 0 }, dir: 1 },
      { pos: { x: 2, y: 0 }, dir: 2 }, // corner: takes the south leg's direction
      { pos: { x: 2, y: 1 }, dir: 2 },
      { pos: { x: 2, y: 2 }, dir: 2 },
    ]);
  });

  it("bends vertical-then-horizontal when bendFirst is 'vertical', corner taking the horizontal leg's direction", () => {
    const path = computeBeltDragPath({ x: 0, y: 0 }, { x: 2, y: 2 }, "vertical");
    expect(path).toEqual([
      { pos: { x: 0, y: 0 }, dir: 2 }, // south leg (corner excluded — it belongs to the horizontal leg)
      { pos: { x: 0, y: 1 }, dir: 2 },
      { pos: { x: 0, y: 2 }, dir: 1 }, // corner: takes the east leg's direction
      { pos: { x: 1, y: 2 }, dir: 1 },
      { pos: { x: 2, y: 2 }, dir: 1 },
    ]);
  });

  it("handles negative deltas (dragging west/north) with correct per-leg directions", () => {
    const path = computeBeltDragPath({ x: 3, y: 3 }, { x: 1, y: 1 }, "horizontal");
    expect(path).toEqual([
      { pos: { x: 3, y: 3 }, dir: 3 }, // west leg
      { pos: { x: 2, y: 3 }, dir: 3 },
      { pos: { x: 1, y: 3 }, dir: 0 }, // corner: north leg's direction
      { pos: { x: 1, y: 2 }, dir: 0 },
      { pos: { x: 1, y: 1 }, dir: 0 },
    ]);
  });
});

describe("bottleneck detection", () => {
  function buildChain(): SimState {
    // source -> stack inserter -> slow (am1) assembler -> stack inserter -> sink,
    // powered by a single substation touching the grid edge. The assembler's
    // fixed craft rate (1 iron-gear-wheel/sec, needing 2 iron-plate/sec) is the
    // slowest stage: both inserters are individually capable of far more than
    // that, so once their small input/output buffers saturate they spend part
    // of every cycle blocked/starved while the assembler runs flat out.
    const state = createState(8, 6);
    const entities: Entity[] = [
      { id: 1, kind: "item-source", pos: { x: 0, y: 1 }, dir: 1, item: "iron-plate" },
      {
        id: 2,
        kind: "inserter",
        pos: { x: 1, y: 1 },
        dir: 1,
        type: "stack",
        filter: null,
        swingTicksRemaining: null,
        swingTotalTicks: 0,
        held: null,
        heldCount: 0,
      },
      {
        id: 3,
        kind: "assembler",
        pos: { x: 2, y: 1 },
        dir: 1,
        tier: "am1",
        recipeId: "iron-gear-wheel",
        progress: 0,
        inputBuffer: {},
        outputBuffer: {},
        poweredThisTick: false,
      },
      {
        id: 4,
        kind: "inserter",
        pos: { x: 5, y: 2 },
        dir: 1,
        type: "stack",
        filter: null,
        swingTicksRemaining: null,
        swingTotalTicks: 0,
        held: null,
        heldCount: 0,
      },
      { id: 5, kind: "item-sink", pos: { x: 6, y: 2 }, dir: 1, totalCount: 0, history: [] },
      { id: 6, kind: "pole", pos: { x: 0, y: 4 }, tier: "substation", networkId: null },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 7;
    return state;
  }

  it("identifies the slow assembler as the constraint, not either feeder inserter", () => {
    const state = buildChain();
    const result = runBottleneckAnalysis(state, 3600); // one simulated minute, per the plan's default

    expect(result.entityId).toBe(3);
    expect(state.entities.get(result.entityId!)?.kind).toBe("assembler");
    expect(result.utilisation).toBeGreaterThan(0.9);
    expect(result.throughputPerMinute).toBeGreaterThan(0);
  });

  it("runs a full minute at the documented 60 ticks/second", () => {
    const state = buildChain();
    runBottleneckAnalysis(state, 3600);
    expect(state.tick).toBe(3600);
    expect(state.tick / TICKS_PER_SECOND).toBe(60);
  });
});

describe("belt corner turns", () => {
  it("preserves both feeder lanes through a plain corner, not a T-junction merge", () => {
    // A lone 90-degree turn (no competing straight feeder behind the destination) must
    // carry both of the feeder's lanes onto the destination's two lanes, matching a real
    // belt turn — collapsing both onto one lane is only correct for a genuine T-junction.
    const state = createState(4, 4);
    const entities: Entity[] = [
      {
        id: 1,
        kind: "belt",
        pos: { x: 0, y: 0 },
        dir: 1,
        tier: "yellow",
        lanes: [[{ item: "iron-plate", pos: 0.95 }], [{ item: "iron-plate", pos: 0.95 }]],
      },
      { id: 2, kind: "belt", pos: { x: 1, y: 0 }, dir: 2, tier: "yellow", lanes: [[], []] },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 3;

    tickMany(state, 30);

    const dest = state.entities.get(2) as Extract<Entity, { kind: "belt" }>;
    expect(dest.lanes[0].length + dest.lanes[1].length).toBe(2);
  });

  it("keeps each lane's left/right identity through the turn instead of swapping sides", () => {
    // An eastbound belt's lane 0 (north/left, since east's left side is north) turning
    // into a southbound belt must land on the southbound belt's lane 0 (east/left, since
    // south's left side is east) — not swapped onto its lane 1 (west/right). Verified
    // against current in-game behavior per the user's report.
    const state = createState(4, 4);
    const entities: Entity[] = [
      {
        id: 1,
        kind: "belt",
        pos: { x: 0, y: 0 },
        dir: 1, // east; lane 0 = north/left, lane 1 = south/right
        tier: "yellow",
        lanes: [[{ item: "left-lane-item", pos: 0.95 }], [{ item: "right-lane-item", pos: 0.95 }]],
      },
      { id: 2, kind: "belt", pos: { x: 1, y: 0 }, dir: 2, tier: "yellow", lanes: [[], []] }, // south; lane 0 = east/left, lane 1 = west/right
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 3;

    tickMany(state, 30);

    const dest = state.entities.get(2) as Extract<Entity, { kind: "belt" }>;
    expect(dest.lanes[0].map((i) => i.item)).toEqual(["left-lane-item"]);
    expect(dest.lanes[1].map((i) => i.item)).toEqual(["right-lane-item"]);
  });

  it("collapses both feeders onto side-based lanes for a T-junction formed by two perpendicular feeders, not a straight one", () => {
    // [E, S, W]: an eastbound belt and a westbound belt both feed a southbound belt from
    // opposite sides, with nothing feeding it straight from behind. S still can't collapse
    // into a single bend — it's a T-junction — so per the user's report ALL of E's output
    // goes to S's lane B (S's west/right side) and ALL of W's output goes to S's lane A
    // (S's east/left side), rather than each being treated as an independent plain corner.
    const state = createState(4, 4);
    const entities: Entity[] = [
      {
        id: 1,
        kind: "belt",
        pos: { x: 0, y: 1 },
        dir: 1, // east
        tier: "yellow",
        lanes: [[{ item: "e-a", pos: 0.95 }], [{ item: "e-b", pos: 0.95 }]],
      },
      { id: 2, kind: "belt", pos: { x: 1, y: 1 }, dir: 2, tier: "yellow", lanes: [[], []] }, // south (dest)
      {
        id: 3,
        kind: "belt",
        pos: { x: 2, y: 1 },
        dir: 3, // west
        tier: "yellow",
        lanes: [[{ item: "w-a", pos: 0.95 }], [{ item: "w-b", pos: 0.95 }]],
      },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 4;

    tickMany(state, 30);

    const dest = state.entities.get(2) as Extract<Entity, { kind: "belt" }>;
    expect(dest.lanes[0].map((i) => i.item).sort()).toEqual(["w-a", "w-b"]);
    expect(dest.lanes[1].map((i) => i.item).sort()).toEqual(["e-a", "e-b"]);
  });

  it("lets a merged feeder's upstream lane claim the shared destination lane before its other lane", () => {
    // Within a single feeder whose two lanes collapse onto one destination lane, the lane
    // on the side OPPOSITE the collapsed lane is upstream and wins the shared slot first;
    // the other lane defers a tick rather than squeezing through alongside it. Here E's
    // output collapses onto dest's lane B (right), so E's own lane A (index 0) goes first.
    const state = createState(4, 4);
    const entities: Entity[] = [
      {
        id: 1,
        kind: "belt",
        pos: { x: 0, y: 1 },
        dir: 1, // east
        tier: "yellow",
        lanes: [[{ item: "e-a", pos: 0.95 }], [{ item: "e-b", pos: 0.95 }]],
      },
      { id: 2, kind: "belt", pos: { x: 1, y: 1 }, dir: 2, tier: "yellow", lanes: [[], []] },
      { id: 3, kind: "belt", pos: { x: 2, y: 1 }, dir: 3, tier: "yellow", lanes: [[], []] }, // structural W feeder, forces the T-junction
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 4;

    tickMany(state, 2); // exactly enough ticks for the priority lane's front item to cross

    const dest = state.entities.get(2) as Extract<Entity, { kind: "belt" }>;
    const feeder = state.entities.get(1) as Extract<Entity, { kind: "belt" }>;
    expect(dest.lanes[1].map((i) => i.item)).toEqual(["e-a"]);
    expect(feeder.lanes[1].map((i) => i.item)).toEqual(["e-b"]); // deferred, not squeezed through
  });
});

describe("underground belt entrance/exit sideload (tunnel hood)", () => {
  // wiki.factorio.com/Belt_transport_system + forums.factorio.com/viewtopic.php?t=60991:
  // sideloading onto an underground belt entrance/exit can only ever reach the OUTER lane
  // of the turn (the tunnel "hood" physically blocks the inner lane's half of the tile),
  // unlike a plain corner between two ordinary belts, which passes both lanes through.
  // [E, S_ugin] per the user's report: an eastbound belt turning into a south-facing
  // underground entrance is a clockwise turn, so the eastbound belt's north/left lane
  // (lane 0) is the outer lane and lands on the underground's east/left lane (lane 0);
  // the eastbound belt's south/right lane (lane 1, inner) has no path in and backs up.
  it("[E, S_ugin] lets only the outer (left) lane of an eastbound feeder into a south-facing underground entrance", () => {
    const state = createState(3, 3);
    const entities: Entity[] = [
      {
        id: 1,
        kind: "belt",
        pos: { x: 0, y: 0 },
        dir: 1, // east; lane 0 = north/left (outer for this turn), lane 1 = south/right (inner)
        tier: "yellow",
        lanes: [[{ item: "left-item", pos: 0.95 }], [{ item: "right-item", pos: 0.95 }]],
      },
      {
        id: 2,
        kind: "underground-belt",
        pos: { x: 1, y: 0 },
        dir: 2, // south
        tier: "yellow",
        role: "entrance",
        lanes: [[], []],
        tunnel: [[], []],
        partnerId: null,
      },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 3;

    tickMany(state, 30);

    const feeder = state.entities.get(1) as Extract<Entity, { kind: "belt" }>;
    const ug = state.entities.get(2) as Extract<Entity, { kind: "underground-belt" }>;
    expect(ug.lanes[0].map((i) => i.item)).toEqual(["left-item"]);
    expect(ug.lanes[1]).toHaveLength(0);
    // The inner (right) lane never had anywhere to go — it backs up on the feeder instead
    // of crossing over, rather than silently vanishing or forcing its way onto lane 0.
    expect(feeder.lanes[1].map((i) => i.item)).toEqual(["right-item"]);
  });

  it("still lets a straight (behind) feeder into an underground entrance unaffected by the hood", () => {
    const state = createState(2, 1);
    const entities: Entity[] = [
      { id: 1, kind: "belt", pos: { x: 0, y: 0 }, dir: 1, tier: "yellow", lanes: [[{ item: "a", pos: 0.95 }], [{ item: "b", pos: 0.95 }]] },
      {
        id: 2,
        kind: "underground-belt",
        pos: { x: 1, y: 0 },
        dir: 1,
        tier: "yellow",
        role: "entrance",
        lanes: [[], []],
        tunnel: [[], []],
        partnerId: null,
      },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 3;

    tickMany(state, 30);

    const ug = state.entities.get(2) as Extract<Entity, { kind: "underground-belt" }>;
    expect(ug.lanes[0].map((i) => i.item)).toEqual(["a"]);
    expect(ug.lanes[1].map((i) => i.item)).toEqual(["b"]);
  });
});

describe("underground belt pairing", () => {
  it("pairs across a plain surface belt crossing the tunnel gap (only same-tier undergrounds obstruct)", () => {
    const state = createState(5, 3);
    const entities: Entity[] = [
      {
        id: 1,
        kind: "underground-belt",
        pos: { x: 0, y: 0 },
        dir: 1,
        tier: "yellow",
        role: "entrance",
        lanes: [[], []],
        tunnel: [[], []],
        partnerId: null,
      },
      { id: 2, kind: "belt", pos: { x: 1, y: 0 }, dir: 0, tier: "yellow", lanes: [[], []] },
      {
        id: 3,
        kind: "underground-belt",
        pos: { x: 3, y: 0 },
        dir: 1,
        tier: "yellow",
        role: "exit",
        lanes: [[], []],
        tunnel: [[], []],
        partnerId: null,
      },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 4;

    tickMany(state, 1);

    const entrance = state.entities.get(1) as Extract<Entity, { kind: "underground-belt" }>;
    const exit = state.entities.get(3) as Extract<Entity, { kind: "underground-belt" }>;
    expect(entrance.partnerId).toBe(3);
    expect(exit.partnerId).toBe(1);
  });

  it("[E, E_ug, E_ug, E] carries an item from the first belt, through an adjacent underground pair, to the last belt", () => {
    const state = createState(4, 1);
    const entities: Entity[] = [
      { id: 1, kind: "belt", pos: { x: 0, y: 0 }, dir: 1, tier: "yellow", lanes: [[{ item: "iron-plate", pos: 0.5 }], []] },
      {
        id: 2,
        kind: "underground-belt",
        pos: { x: 1, y: 0 },
        dir: 1,
        tier: "yellow",
        role: "entrance",
        lanes: [[], []],
        tunnel: [[], []],
        partnerId: null,
      },
      {
        id: 3,
        kind: "underground-belt",
        pos: { x: 2, y: 0 },
        dir: 1,
        tier: "yellow",
        role: "exit",
        lanes: [[], []],
        tunnel: [[], []],
        partnerId: null,
      },
      { id: 4, kind: "belt", pos: { x: 3, y: 0 }, dir: 1, tier: "yellow", lanes: [[], []] },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 5;

    tickMany(state, 2000);

    const last = state.entities.get(4) as Extract<Entity, { kind: "belt" }>;
    expect(last.lanes[0].map((i) => i.item)).toContain("iron-plate");
  });

  it("[E, E_ug, _, _, E_ug, E] carries an item across a 2-tile gap between the underground pair, to the last belt", () => {
    const state = createState(6, 1);
    const entities: Entity[] = [
      { id: 1, kind: "belt", pos: { x: 0, y: 0 }, dir: 1, tier: "yellow", lanes: [[{ item: "iron-plate", pos: 0.5 }], []] },
      {
        id: 2,
        kind: "underground-belt",
        pos: { x: 1, y: 0 },
        dir: 1,
        tier: "yellow",
        role: "entrance",
        lanes: [[], []],
        tunnel: [[], []],
        partnerId: null,
      },
      // x=2 and x=3 are left empty — the underground gap.
      {
        id: 3,
        kind: "underground-belt",
        pos: { x: 4, y: 0 },
        dir: 1,
        tier: "yellow",
        role: "exit",
        lanes: [[], []],
        tunnel: [[], []],
        partnerId: null,
      },
      { id: 4, kind: "belt", pos: { x: 5, y: 0 }, dir: 1, tier: "yellow", lanes: [[], []] },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 5;

    tickMany(state, 2000);

    const last = state.entities.get(4) as Extract<Entity, { kind: "belt" }>;
    expect(last.lanes[0].map((i) => i.item)).toContain("iron-plate");
  });

  it("tunnels an item across an adjacent pair in roughly the time a single belt tile would take, not the tier's max gap", () => {
    // Same [E, E_ug, E_ug, E] layout as above (entrance and exit are adjacent — 1 tile
    // apart), but bounded to a tick count that only a distance-scaled tunnel (not one
    // always timed to yellow's 4-tile max gap) can clear in time.
    const state = createState(4, 1);
    const entities: Entity[] = [
      { id: 1, kind: "belt", pos: { x: 0, y: 0 }, dir: 1, tier: "yellow", lanes: [[{ item: "iron-plate", pos: 0.5 }], []] },
      {
        id: 2,
        kind: "underground-belt",
        pos: { x: 1, y: 0 },
        dir: 1,
        tier: "yellow",
        role: "entrance",
        lanes: [[], []],
        tunnel: [[], []],
        partnerId: null,
      },
      {
        id: 3,
        kind: "underground-belt",
        pos: { x: 2, y: 0 },
        dir: 1,
        tier: "yellow",
        role: "exit",
        lanes: [[], []],
        tunnel: [[], []],
        partnerId: null,
      },
      { id: 4, kind: "belt", pos: { x: 3, y: 0 }, dir: 1, tier: "yellow", lanes: [[], []] },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 5;

    tickMany(state, 150); // ~80 ticks needed once transit scales to the real 1-tile gap; ~176 needed under the old always-max-gap (4 tiles) behavior.

    const last = state.entities.get(4) as Extract<Entity, { kind: "belt" }>;
    expect(last.lanes[0].map((i) => i.item)).toContain("iron-plate");
  });

  it("caps how many items an unpaired underground belt's tunnel can buffer, instead of absorbing a continuous feed forever", () => {
    // Real capacity scales with belt density (BELT_MIN_ITEM_GAP, wiki.factorio.com/
    // Transport_belts/Physics) across the tunnel's actual tile span (forums.factorio.com/
    // 122855's paired-belt item count confirms 8/tile combined lanes x total tile length),
    // never an unbounded amount. An unpaired entrance falls back to its tier's max gap as
    // its span. Before the fix, a permanently-stuck item (nothing to pair with) reset its
    // own "remaining" to 0 every tick, which made the entry gate see infinite room forever,
    // so a continuous feed piled up without any limit.
    const state = createState(5, 1);
    const entities: Entity[] = [
      { id: 1, kind: "item-source", pos: { x: 0, y: 0 }, dir: 1, item: "iron-plate" },
      { id: 2, kind: "belt", pos: { x: 1, y: 0 }, dir: 1, tier: "yellow", lanes: [[], []] },
      {
        id: 3,
        kind: "underground-belt",
        pos: { x: 2, y: 0 },
        dir: 1,
        tier: "yellow",
        role: "entrance",
        lanes: [[], []],
        tunnel: [[], []],
        partnerId: null,
      },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 4;

    tickMany(state, 3000); // long enough for a continuous feed to saturate any real cap.

    const entrance = state.entities.get(3) as Extract<Entity, { kind: "underground-belt" }>;
    expect(entrance.partnerId).toBeNull(); // nothing ahead to pair with — unpaired for this whole run.
    const maxPerLane = Math.floor(UNDERGROUND_BELT_MAX_GAP.yellow / BELT_MIN_ITEM_GAP);
    expect(entrance.tunnel[0].length).toBeLessThanOrEqual(maxPerLane);
    expect(entrance.tunnel[1].length).toBeLessThanOrEqual(maxPerLane);
    const total = entrance.tunnel[0].length + entrance.tunnel[1].length;
    expect(total).toBeGreaterThan(0);

    tickMany(state, 500); // keep feeding — a real cap must not keep growing from here.
    expect(entrance.tunnel[0].length + entrance.tunnel[1].length).toBe(total);
  });

  it("keeps a tunnel item parked rather than force-pushing it onto a jammed exit lane", () => {
    // The tunnel-to-exit handoff used to be unconditional, bypassing the same min-gap
    // check a regular belt-to-belt crossing already respects — so a jammed exit lane
    // never pushed back, and the tunnel just kept draining onto it in violation of
    // BELT_MIN_ITEM_GAP instead of holding the item until there was room.
    const state = createState(3, 1);
    const entities: Entity[] = [
      {
        id: 1,
        kind: "underground-belt",
        pos: { x: 0, y: 0 },
        dir: 1,
        tier: "yellow",
        role: "entrance",
        lanes: [[], []],
        tunnel: [[], []],
        partnerId: null,
      },
      {
        id: 2,
        kind: "underground-belt",
        pos: { x: 1, y: 0 },
        dir: 1,
        tier: "yellow",
        role: "exit",
        lanes: [[{ item: "iron-plate", pos: 0 }], []], // jammed right at the entry point.
        tunnel: [[], []],
        partnerId: null,
      },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 3;

    const entrance = state.entities.get(1) as Extract<Entity, { kind: "underground-belt" }>;
    entrance.tunnel[0].push({ item: "copper-plate", remaining: 0.01 }); // about to arrive this tick.

    tickMany(state, 1);

    const exit = state.entities.get(2) as Extract<Entity, { kind: "underground-belt" }>;
    expect(exit.lanes[0].map((i) => i.item)).toEqual(["iron-plate"]); // nothing forced in.
    expect(entrance.tunnel[0].map((i) => i.item)).toContain("copper-plate"); // still waiting in the tunnel.
  });
});

describe("underground belt role auto-detection", () => {
  const ugYellow = PALETTE.find((p) => p.id === "ug-belt-yellow")!;

  it("auto-detects an exit when placed within range of an unpaired same-facing entrance", () => {
    const state = createState(6, 1);
    const editor = createEditorState();
    editor.dir = 1; // east
    editor.tool = { mode: "place", spec: ugYellow };
    handleClick(state, editor, { x: 0, y: 0 }); // nothing nearby yet — falls back to "entrance"
    handleClick(state, editor, { x: 2, y: 0 }); // 2 tiles ahead, within yellow's max gap of 4
    tickMany(state, 1); // resolveUndergroundPartners only runs during a tick

    const first = state.entities.get(1) as Extract<Entity, { kind: "underground-belt" }>;
    const second = state.entities.get(2) as Extract<Entity, { kind: "underground-belt" }>;
    expect(first.role).toBe("entrance");
    expect(second.role).toBe("exit");
    expect(first.partnerId).toBe(second.id);
    expect(second.partnerId).toBe(first.id);
  });

  it("auto-detects an entrance when placed within range of an unpaired same-facing exit", () => {
    const state = createState(6, 1);
    const editor = createEditorState();
    editor.dir = 1; // east
    editor.tool = { mode: "place", spec: ugYellow };
    toggleUndergroundRole(editor); // nothing nearby for the first placement, so its fallback is "exit"
    handleClick(state, editor, { x: 3, y: 0 });
    handleClick(state, editor, { x: 1, y: 0 }); // 2 tiles behind, within range, still facing east
    tickMany(state, 1); // resolveUndergroundPartners only runs during a tick

    const exitEntity = state.entities.get(1) as Extract<Entity, { kind: "underground-belt" }>;
    const entranceEntity = state.entities.get(2) as Extract<Entity, { kind: "underground-belt" }>;
    expect(exitEntity.role).toBe("exit");
    expect(entranceEntity.role).toBe("entrance");
    expect(entranceEntity.partnerId).toBe(exitEntity.id);
  });

  it("falls back to the manually toggled role beyond the tier's max gap", () => {
    const state = createState(10, 1);
    const editor = createEditorState();
    editor.dir = 1; // east
    editor.tool = { mode: "place", spec: ugYellow };
    handleClick(state, editor, { x: 0, y: 0 }); // entrance, fallback
    handleClick(state, editor, { x: 6, y: 0 }); // 6 tiles ahead, beyond yellow's max gap of 4

    const second = state.entities.get(2) as Extract<Entity, { kind: "underground-belt" }>;
    expect(second.role).toBe("entrance"); // no candidate in range, so the editor's own default applies
  });
});

describe("splitter routing", () => {
  // Splitter at (2,0)/(2,1) facing east: left column (2,0) exits onto belt (3,0),
  // right column (2,1) exits onto belt (3,1). Per wiki.factorio.com/Belt_transport_system's
  // Splitters section: a lane's left/right identity never crosses to the other lane, the
  // default (no filter, no priority) split is 1:1 between the two outputs, and a fully
  // backed-up output gets skipped in favour of the other one.
  function buildSplitterRig(leftOutputBlocked: boolean): SimState {
    const state = createState(4, 2);
    const entities: Entity[] = [
      {
        id: 1,
        kind: "splitter",
        pos: { x: 2, y: 0 },
        dir: 1, // east
        tier: "yellow",
        filter: null,
        filterSide: "left",
        inputPriority: "none",
        outputPriority: "none",
        nextOutput: ["left", "left"],
        // 5 items already queued on the left column's lane 0, packed at the belt's own
        // min item gap, front one ready to exit immediately.
        lanesLeft: [
          [
            { item: "a", pos: 0.2 },
            { item: "b", pos: 0.4 },
            { item: "c", pos: 0.6 },
            { item: "d", pos: 0.8 },
            { item: "e", pos: 1 },
          ],
          [],
        ],
        lanesRight: [[], []],
      },
      {
        id: 2,
        kind: "belt",
        pos: { x: 3, y: 0 },
        dir: 1,
        tier: "yellow",
        // Packed at min item gap with nothing ahead to drain into: a genuinely full,
        // permanently-stalled lane (a single item at the front would just roll up to
        // the edge and free room behind it, not stay "blocked").
        lanes: leftOutputBlocked
          ? [
              [
                { item: "blocker-0", pos: 0 },
                { item: "blocker-1", pos: 0.25 },
                { item: "blocker-2", pos: 0.5 },
                { item: "blocker-3", pos: 0.75 },
                { item: "blocker-4", pos: 1 },
              ],
              [],
            ]
          : [[], []],
      },
      { id: 3, kind: "belt", pos: { x: 3, y: 1 }, dir: 1, tier: "yellow", lanes: [[], []] },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 4;
    return state;
  }

  it("splits a lane's items 1:1 between the two outputs instead of always favouring the same side", () => {
    const state = buildSplitterRig(false);
    tickMany(state, 1500);

    const leftOut = state.entities.get(2) as Extract<Entity, { kind: "belt" }>;
    const rightOut = state.entities.get(3) as Extract<Entity, { kind: "belt" }>;

    // Round-robin starting on "left": a, c, e -> left; b, d -> right.
    expect(leftOut.lanes[0].map((i) => i.item).sort()).toEqual(["a", "c", "e"]);
    expect(rightOut.lanes[0].map((i) => i.item).sort()).toEqual(["b", "d"]);
    // Lane identity is preserved: nothing lands on the other lane of either output.
    expect(leftOut.lanes[1]).toHaveLength(0);
    expect(rightOut.lanes[1]).toHaveLength(0);
  });

  it("sends all of a lane's items to the other output once its preferred side is fully backed up", () => {
    const state = buildSplitterRig(true);
    tickMany(state, 1500);

    const leftOut = state.entities.get(2) as Extract<Entity, { kind: "belt" }>;
    const rightOut = state.entities.get(3) as Extract<Entity, { kind: "belt" }>;

    expect(leftOut.lanes[0].map((i) => i.item)).toEqual([
      "blocker-0",
      "blocker-1",
      "blocker-2",
      "blocker-3",
      "blocker-4",
    ]); // untouched, still jammed.
    expect(rightOut.lanes[0].map((i) => i.item).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("inserter belt lane selection on drop", () => {
  // wiki.factorio.com/inserters: an inserter dropping onto a belt "only places items onto
  // one side of the belt, either the far side from the inserter's perspective, or, if the
  // belt is going the same or the opposite direction as the inserter, the right side from
  // the belt's perspective" — the FAR lane, never the near one, and with no fallback to the
  // other lane if it's blocked (this is the well-known, counterintuitive "why do inserters
  // prefer the far side of the belt" behavior). A drop tile sits ahead of the inserter (same
  // as its facing), so the inserter's own physical side of it is the OPPOSITE of its facing;
  // the near lane on that side is therefore the one the inserter must NOT use.
  function buildDropRig(inserterDir: 0 | 2): SimState {
    // Belt at (1,2) facing east: lane 0 = north/left, lane 1 = south/right.
    const state = createState(4, 5);
    const inserterPos = inserterDir === 2 ? { x: 1, y: 1 } : { x: 1, y: 3 }; // north-of vs south-of the belt
    const entities: Entity[] = [
      { id: 1, kind: "item-source", pos: inserterDir === 2 ? { x: 1, y: 0 } : { x: 1, y: 4 }, dir: 1, item: "iron-plate" },
      {
        id: 2,
        kind: "inserter",
        pos: inserterPos,
        dir: inserterDir,
        type: "inserter",
        filter: null,
        swingTicksRemaining: null,
        swingTotalTicks: 0,
        held: null,
        heldCount: 0,
      },
      { id: 3, kind: "belt", pos: { x: 1, y: 2 }, dir: 1, tier: "yellow", lanes: [[], []] },
      { id: 4, kind: "pole", pos: { x: 2, y: 3 }, tier: "substation", networkId: null },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 5;
    return state;
  }

  it("drops onto the belt's FAR lane 1 (south/right) when positioned north of an eastbound belt", () => {
    const state = buildDropRig(2); // facing south: inserter sits north of the belt tile
    tickMany(state, 100); // one full inserter cycle (72 ticks) plus slack

    const belt = state.entities.get(3) as Extract<Entity, { kind: "belt" }>;
    expect(belt.lanes[1].map((i) => i.item)).toEqual(["iron-plate"]);
    expect(belt.lanes[0]).toHaveLength(0);
  });

  it("drops onto the belt's FAR lane 0 (north/left) when positioned south of an eastbound belt", () => {
    const state = buildDropRig(0); // facing north: inserter sits south of the belt tile
    tickMany(state, 100);

    const belt = state.entities.get(3) as Extract<Entity, { kind: "belt" }>;
    expect(belt.lanes[0].map((i) => i.item)).toEqual(["iron-plate"]);
    expect(belt.lanes[1]).toHaveLength(0);
  });
});

describe("stack inserter throughput", () => {
  it("moves INSERTER_STACK_SIZE.stack items per swing, not one like a plain inserter", () => {
    const state = createState(4, 4);
    const entities: Entity[] = [
      { id: 1, kind: "item-source", pos: { x: 0, y: 1 }, dir: 1, item: "iron-plate" },
      {
        id: 2,
        kind: "inserter",
        pos: { x: 1, y: 1 },
        dir: 1,
        type: "stack",
        filter: null,
        swingTicksRemaining: null,
        swingTotalTicks: 0,
        held: null,
        heldCount: 0,
      },
      { id: 3, kind: "item-sink", pos: { x: 2, y: 1 }, dir: 1, totalCount: 0, history: [] },
      // A substation's 2x2 footprint at (0,0) would overlap the item-source (0,1) and
      // inserter (1,1) above and silently fail to place (placeEntity no-ops on overlap);
      // (0,2) is clear of the row-1 entities and still touches the grid's bottom edge.
      { id: 4, kind: "pole", pos: { x: 0, y: 2 }, tier: "substation", networkId: null },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 5;

    tickMany(state, 30); // one full pickup-swing-drop cycle (26 ticks) fits within this window

    const sink = state.entities.get(3) as Extract<Entity, { kind: "item-sink" }>;
    expect(sink.totalCount).toBe(INSERTER_STACK_SIZE.stack);
  });

  it("drops a held stack onto a belt one item at a time, saturating the lane instead of bundling", () => {
    // A belt slot only ever holds one item (base game has no belt-stacking research
    // modeled here — see belt.ts's header and inserter.ts's tryDrop). So a stack
    // inserter's 4-item hand must be placed as 4 separate individually-gapped belt
    // items over successive ticks, not as one bundled multi-item slot. Stop the
    // instant all 4 have individually arrived at the sink (the inserter keeps
    // cycling and grabbing more from the infinite source, so letting the loop run
    // longer would just keep counting past 4) — this also confirms no item is lost
    // or duplicated in transit across two belts.
    const state = createState(6, 4);
    const entities: Entity[] = [
      { id: 1, kind: "item-source", pos: { x: 0, y: 1 }, dir: 1, item: "iron-plate" },
      {
        id: 2,
        kind: "inserter",
        pos: { x: 1, y: 1 },
        dir: 1,
        type: "stack",
        filter: null,
        swingTicksRemaining: null,
        swingTotalTicks: 0,
        held: null,
        heldCount: 0,
      },
      { id: 3, kind: "belt", pos: { x: 2, y: 1 }, dir: 1, tier: "yellow", lanes: [[], []] },
      { id: 4, kind: "belt", pos: { x: 3, y: 1 }, dir: 1, tier: "yellow", lanes: [[], []] },
      { id: 5, kind: "item-sink", pos: { x: 4, y: 1 }, dir: 1, totalCount: 0, history: [] },
      { id: 6, kind: "pole", pos: { x: 0, y: 2 }, tier: "substation", networkId: null },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 7;

    const sink = state.entities.get(5) as Extract<Entity, { kind: "item-sink" }>;
    for (let i = 0; i < 2000 && sink.totalCount < INSERTER_STACK_SIZE.stack; i++) tick(state);

    expect(sink.totalCount).toBe(INSERTER_STACK_SIZE.stack);
  });
});

describe("chest capacity (chestInsert/chestTake)", () => {
  function emptyChest(tier: ChestEntity["tier"]): ChestEntity {
    return { id: 1, kind: "chest", pos: { x: 0, y: 0 }, tier, inventory: {} };
  }

  it("fills a single item type up to slots * stackSize, rejecting the rest", () => {
    const chest = emptyChest("wood"); // 16 slots * 100/stack (iron-plate) = 1600 cap
    const accepted = chestInsert(chest, "iron-plate", 1650);
    expect(accepted).toBe(1600);
    expect(chest.inventory["iron-plate"]).toBe(1600);
  });

  it("constrains a second item type to whatever slots remain after the first", () => {
    const chest = emptyChest("wood"); // 16 slots total
    chestInsert(chest, "iron-plate", 1500); // ceil(1500/100) = 15 slots, 1 slot left
    const accepted = chestInsert(chest, "copper-plate", 250); // would need 3 slots, only 1 free
    expect(accepted).toBe(100); // the one remaining slot's worth of copper-plate's own stack size
    expect(chest.inventory["copper-plate"]).toBe(100);
  });

  it("rejects a new item type outright once every slot is already occupied", () => {
    const chest = emptyChest("wood");
    chestInsert(chest, "iron-plate", 1600); // fills all 16 slots
    const accepted = chestInsert(chest, "copper-plate", 50);
    expect(accepted).toBe(0);
    expect(chest.inventory["copper-plate"]).toBeUndefined();
  });

  it("chestTake removes up to maxCount and deletes the key once emptied", () => {
    const chest = emptyChest("iron"); // 32 slots
    chestInsert(chest, "iron-plate", 500);
    expect(chestTake(chest, "iron-plate", 200)).toBe(200);
    expect(chest.inventory["iron-plate"]).toBe(300);
    expect(chestTake(chest, "iron-plate", 1000)).toBe(300); // capped by what's actually there
    expect(chest.inventory["iron-plate"]).toBeUndefined();
  });
});

describe("infinite loader (tickInfLoaders)", () => {
  function buildRig(laneItems: [string | null, string | null]): SimState {
    const state = createState(6, 3);
    const entities: Entity[] = [
      { id: 1, kind: "inf-loader", pos: { x: 0, y: 1 }, dir: 1, laneItems },
      { id: 2, kind: "belt", pos: { x: 1, y: 1 }, dir: 1, tier: "yellow", lanes: [[], []] },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 3;
    return state;
  }

  it("saturates both lanes independently with different configured items", () => {
    const state = buildRig(["iron-plate", "copper-plate"]);
    tickMany(state, 120); // 2 seconds — plenty of time to pack both lanes to their gap limit

    const belt = state.entities.get(2) as Extract<Entity, { kind: "belt" }>;
    expect(belt.lanes[0].length).toBeGreaterThan(1);
    expect(belt.lanes[1].length).toBeGreaterThan(1);
    expect(belt.lanes[0].every((i) => i.item === "iron-plate")).toBe(true);
    expect(belt.lanes[1].every((i) => i.item === "copper-plate")).toBe(true);
  });

  it("leaves a lane set to null untouched while the other lane fills", () => {
    const state = buildRig([null, "iron-plate"]);
    tickMany(state, 120);

    const belt = state.entities.get(2) as Extract<Entity, { kind: "belt" }>;
    expect(belt.lanes[0]).toHaveLength(0);
    expect(belt.lanes[1].length).toBeGreaterThan(1);
  });

  it("still respects the belt's minimum item gap instead of stacking items on top of each other", () => {
    const state = buildRig(["iron-plate", null]);
    tickMany(state, 120);

    const belt = state.entities.get(2) as Extract<Entity, { kind: "belt" }>;
    const positions = belt.lanes[0].map((i) => i.pos).sort((a, b) => a - b);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i] - positions[i - 1]).toBeGreaterThanOrEqual(BELT_MIN_ITEM_GAP - 1e-6);
    }
  });
});

describe("void chest (tickVoidChests)", () => {
  function buildRig(): SimState {
    const state = createState(6, 3);
    const entities: Entity[] = [
      { id: 1, kind: "belt", pos: { x: 0, y: 1 }, dir: 1, tier: "yellow", lanes: [[], []] },
      { id: 2, kind: "void-chest", pos: { x: 1, y: 1 }, dir: 1, leftCount: 0, rightCount: 0 },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 3;
    return state;
  }

  it("wipes every item on the feeding belt tile in one tick, not just a front item at the exit edge", () => {
    const state = buildRig();
    const belt = state.entities.get(1) as Extract<Entity, { kind: "belt" }>;
    // None of these are at the exit edge (pos === 1), so item-sink's "front.pos >= 1 - 1e-6"
    // gate would leave all three sitting here; the void chest has no such gate.
    belt.lanes[0] = [{ item: "iron-plate", pos: 0.2 }, { item: "iron-plate", pos: 0.6 }];
    belt.lanes[1] = [{ item: "copper-plate", pos: 0.4 }];

    tick(state);

    expect(belt.lanes[0]).toHaveLength(0);
    expect(belt.lanes[1]).toHaveLength(0);
    const chest = state.entities.get(2) as Extract<Entity, { kind: "void-chest" }>;
    expect(chest.leftCount).toBe(2);
    expect(chest.rightCount).toBe(1);
  });

  it("only counts as active on ticks where it actually drains something", () => {
    const state = buildRig();
    tick(state); // both lanes empty — nothing to drain
    const stats = state.stats.get(2);
    expect(stats?.activeTicks).toBe(0);
    expect(stats?.starvedTicks).toBe(1);
  });

  it("reports starved with no belt feeding it at all", () => {
    const state = createState(4, 3);
    placeEntity(state, { id: 1, kind: "void-chest", pos: { x: 1, y: 1 }, dir: 1, leftCount: 0, rightCount: 0 });
    tick(state);
    expect(state.stats.get(1)?.starvedTicks).toBe(1);
  });

  describe("voidChestBalance", () => {
    function chestWith(left: number, right: number): Extract<Entity, { kind: "void-chest" }> {
      return { id: 1, kind: "void-chest", pos: { x: 0, y: 0 }, dir: 1, leftCount: left, rightCount: right };
    }

    it("reads balanced before anything has drained", () => {
      expect(voidChestBalance(chestWith(0, 0))).toBe("balanced");
    });

    it("reads balanced for equal counts, and for a small (<5%) relative difference", () => {
      expect(voidChestBalance(chestWith(100, 100))).toBe("balanced");
      expect(voidChestBalance(chestWith(102, 100))).toBe("balanced");
    });

    it("reads left-heavy or right-heavy once the difference exceeds the tolerance", () => {
      expect(voidChestBalance(chestWith(120, 100))).toBe("left-heavy");
      expect(voidChestBalance(chestWith(100, 120))).toBe("right-heavy");
    });
  });

  it("resets both counts whenever the layout is edited (a placement or removal elsewhere)", () => {
    const state = buildRig();
    const chest = state.entities.get(2) as Extract<Entity, { kind: "void-chest" }>;
    chest.leftCount = 40;
    chest.rightCount = 10;

    placeEntity(state, { id: 3, kind: "pole", pos: { x: 4, y: 0 }, tier: "small", networkId: null });
    expect(chest.leftCount).toBe(0);
    expect(chest.rightCount).toBe(0);

    chest.leftCount = 40;
    chest.rightCount = 10;
    removeEntity(state, 3);
    expect(chest.leftCount).toBe(0);
    expect(chest.rightCount).toBe(0);
  });
});

describe("smart inserter pickup (recipe-filtered, no explicit filter needed)", () => {
  it("only picks up the item its drop-target assembler's recipe needs, ignoring an irrelevant item sharing the belt", () => {
    // In-line pickup (belt and inserter face the same way), so near/far is ambiguous and
    // lane 0 is checked first (see inserter.ts's nearLaneIndexFor) — lane 0 carries the
    // irrelevant item specifically to prove the filter skips it rather than just happening
    // to reach for lane 1 first.
    const state = createState(6, 4);
    const entities: Entity[] = [
      {
        id: 1,
        kind: "belt",
        pos: { x: 0, y: 1 },
        dir: 1,
        tier: "yellow",
        lanes: [[{ item: "copper-plate", pos: 0.95 }], [{ item: "iron-plate", pos: 0.95 }]],
      },
      {
        id: 2,
        kind: "inserter",
        pos: { x: 1, y: 1 },
        dir: 1,
        type: "inserter",
        filter: null,
        swingTicksRemaining: null,
        swingTotalTicks: 0,
        held: null,
        heldCount: 0,
      },
      {
        id: 3,
        kind: "assembler",
        pos: { x: 2, y: 1 },
        dir: 1,
        tier: "am1",
        recipeId: "iron-gear-wheel", // needs only iron-plate
        progress: 0,
        inputBuffer: {},
        outputBuffer: {},
        poweredThisTick: false,
      },
      { id: 4, kind: "pole", pos: { x: 0, y: 2 }, tier: "substation", networkId: null },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 5;

    tickMany(state, 200); // several inserter cycles' worth of headroom

    const belt = state.entities.get(1) as Extract<Entity, { kind: "belt" }>;
    const assembler = state.entities.get(3) as Extract<Entity, { kind: "assembler" }>;
    expect(assembler.inputBuffer["iron-plate"]).toBe(1);
    expect(assembler.inputBuffer["copper-plate"]).toBeUndefined();
    expect(belt.lanes[1]).toHaveLength(0); // the needed item was taken
    // The irrelevant item was never picked up — it's still on the belt (its own pos may
    // have crept forward since nothing downstream ever consumes it, so only the item
    // identity is asserted here, not its exact position).
    expect(belt.lanes[0].map((i) => i.item)).toEqual(["copper-plate"]);
  });

  it("still prefers the near lane first when both lanes carry the needed item", () => {
    // Inserter sits south of an eastbound belt, facing south: its physical side of the
    // pickup tile is south, which nearLaneIndexFor maps to the belt's lane 1 (south/right)
    // — see the "inserter belt lane selection on drop" describe block above for the same
    // lane convention used from the drop side.
    const state = createState(6, 6);
    const entities: Entity[] = [
      {
        id: 1,
        kind: "belt",
        pos: { x: 1, y: 1 },
        dir: 1,
        tier: "yellow",
        lanes: [[{ item: "iron-plate", pos: 0.95 }], [{ item: "iron-plate", pos: 0.95 }]],
      },
      {
        id: 2,
        kind: "inserter",
        pos: { x: 1, y: 2 },
        dir: 2,
        type: "inserter",
        filter: null,
        swingTicksRemaining: null,
        swingTotalTicks: 0,
        held: null,
        heldCount: 0,
      },
      {
        id: 3,
        kind: "assembler",
        pos: { x: 1, y: 3 },
        dir: 1,
        tier: "am1",
        recipeId: "iron-gear-wheel",
        progress: 0,
        inputBuffer: {},
        outputBuffer: {},
        poweredThisTick: false,
      },
      { id: 4, kind: "pole", pos: { x: 4, y: 0 }, tier: "substation", networkId: null },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 5;

    // Pickup happens instantly once swingTicksRemaining is null (see inserter.ts's
    // tickInserters), i.e. on the very first tick — a longer run would let the inserter
    // finish its ~72-tick swing, drop, and instantly start a second pickup that would
    // also drain the far lane, which would defeat the point of this assertion.
    tickMany(state, 2);

    const belt = state.entities.get(1) as Extract<Entity, { kind: "belt" }>;
    expect(belt.lanes[1]).toHaveLength(0); // near lane (south/right) taken first
    expect(belt.lanes[0].map((i) => i.item)).toEqual(["iron-plate"]); // far lane untouched
  });

  it("skips an ingredient already at its input-buffer cap in favour of one the recipe still needs", () => {
    // electronic-circuit needs 1 iron-plate (cap 1*5=5) and 3 copper-cable (cap 3*5=15) — see
    // constants.ts. The assembler here starts with iron-plate already at that cap, reproducing
    // the reported bug ("assembly machine making electronic circuits with 5 iron plates in the
    // buffer... should try picking up a copper wire instead"). Lane 0 carries the at-cap item
    // and is checked first (in-line pickup, order [0, 1] — see nearLaneIndexFor), so grabbing
    // copper-cable here can only be the destinationRoomFor gate skipping the full ingredient,
    // not incidental lane ordering.
    const state = createState(6, 4);
    const entities: Entity[] = [
      {
        id: 1,
        kind: "belt",
        pos: { x: 0, y: 1 },
        dir: 1,
        tier: "yellow",
        lanes: [[{ item: "iron-plate", pos: 0.95 }], [{ item: "copper-cable", pos: 0.95 }]],
      },
      {
        id: 2,
        kind: "inserter",
        pos: { x: 1, y: 1 },
        dir: 1,
        type: "inserter",
        filter: null,
        swingTicksRemaining: null,
        swingTotalTicks: 0,
        held: null,
        heldCount: 0,
      },
      {
        id: 3,
        kind: "assembler",
        pos: { x: 2, y: 1 },
        dir: 1,
        tier: "am1",
        recipeId: "electronic-circuit",
        progress: 0,
        inputBuffer: { "iron-plate": 5 }, // already at cap
        outputBuffer: {},
        poweredThisTick: false,
      },
      { id: 4, kind: "pole", pos: { x: 0, y: 2 }, tier: "substation", networkId: null },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 5;

    tickMany(state, 200); // several inserter cycles' worth of headroom

    const belt = state.entities.get(1) as Extract<Entity, { kind: "belt" }>;
    const assembler = state.entities.get(3) as Extract<Entity, { kind: "assembler" }>;
    expect(assembler.inputBuffer["iron-plate"]).toBe(5); // untouched — already full
    expect(assembler.inputBuffer["copper-cable"]).toBe(1); // picked up instead
    expect(belt.lanes[1]).toHaveLength(0); // copper-cable taken
    expect(belt.lanes[0].map((i) => i.item)).toEqual(["iron-plate"]); // left in place, never grabbed
  });
});

describe("inserter idles empty-handed unless the drop destination is belt-like", () => {
  it("never picks up when the destination chest is already full for that item", () => {
    const state = createState(6, 4);
    const entities: Entity[] = [
      { id: 1, kind: "item-source", pos: { x: 0, y: 1 }, dir: 1, item: "iron-plate" },
      {
        id: 2,
        kind: "inserter",
        pos: { x: 1, y: 1 },
        dir: 1,
        type: "inserter",
        filter: null,
        swingTicksRemaining: null,
        swingTotalTicks: 0,
        held: null,
        heldCount: 0,
      },
      // wood chest: 16 slots * 100 (iron-plate stack size) = 1600 cap, already full.
      { id: 3, kind: "chest", pos: { x: 2, y: 1 }, tier: "wood", inventory: { "iron-plate": 1600 } },
      { id: 4, kind: "pole", pos: { x: 0, y: 2 }, tier: "substation", networkId: null },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 5;

    tickMany(state, 200); // ample headroom for several inserter cycles

    const inserter = state.entities.get(2) as Extract<Entity, { kind: "inserter" }>;
    const chest = state.entities.get(3) as Extract<Entity, { kind: "chest" }>;
    expect(inserter.held).toBeNull(); // idle, never grabbed an item it couldn't place
    expect(inserter.heldCount).toBe(0);
    expect(inserter.swingTicksRemaining).toBeNull();
    expect(chest.inventory["iron-plate"]).toBe(1600); // unchanged
  });

  it("never picks up when there is no drop destination placed at all", () => {
    const state = createState(6, 4);
    const entities: Entity[] = [
      { id: 1, kind: "item-source", pos: { x: 0, y: 1 }, dir: 1, item: "iron-plate" },
      {
        id: 2,
        kind: "inserter",
        pos: { x: 1, y: 1 },
        dir: 1,
        type: "inserter",
        filter: null,
        swingTicksRemaining: null,
        swingTotalTicks: 0,
        held: null,
        heldCount: 0,
      },
      // Nothing placed at (2, 1) — the inserter's drop tile.
      { id: 3, kind: "pole", pos: { x: 0, y: 2 }, tier: "substation", networkId: null },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 4;

    tickMany(state, 200);

    const inserter = state.entities.get(2) as Extract<Entity, { kind: "inserter" }>;
    expect(inserter.held).toBeNull();
    expect(inserter.heldCount).toBe(0);
    expect(inserter.swingTicksRemaining).toBeNull();
  });
});

describe("wouldPoleConnect (placement preview)", () => {
  it("is true when the ghost pole falls within the combined wire reach of an existing pole", () => {
    const state = createState(12, 2);
    placeEntity(state, { id: 1, kind: "pole", pos: { x: 0, y: 0 }, tier: "small", networkId: null });
    // small wireReach = 7.5 (see POLE_SPEC); footprint 1, so pole centers equal their positions.
    const ghost: PoleEntity = { id: -1, kind: "pole", pos: { x: 7, y: 0 }, tier: "small", networkId: null };
    expect(wouldPoleConnect(state, ghost)).toBe(true);
  });

  it("is false once the ghost pole is placed beyond the combined wire reach", () => {
    const state = createState(12, 2);
    placeEntity(state, { id: 1, kind: "pole", pos: { x: 0, y: 0 }, tier: "small", networkId: null });
    const ghost: PoleEntity = { id: -1, kind: "pole", pos: { x: 8, y: 0 }, tier: "small", networkId: null };
    expect(wouldPoleConnect(state, ghost)).toBe(false);
  });
});

describe("clearAllItems", () => {
  it("empties every item-bearing entity but leaves the layout, config, and topology untouched", () => {
    const state = createState(12, 5);
    const entities: Entity[] = [
      {
        id: 1,
        kind: "belt",
        pos: { x: 0, y: 1 },
        dir: 1,
        tier: "yellow",
        lanes: [[{ item: "iron-plate", pos: 0.5 }], [{ item: "copper-plate", pos: 0.3 }]],
      },
      {
        id: 2,
        kind: "underground-belt",
        pos: { x: 1, y: 1 },
        dir: 1,
        tier: "yellow",
        role: "entrance",
        lanes: [[{ item: "iron-plate", pos: 0.5 }], []],
        tunnel: [[{ item: "iron-plate", remaining: 1.5 }], []],
        partnerId: 3,
      },
      {
        id: 4,
        kind: "splitter",
        pos: { x: 3, y: 1 },
        dir: 1,
        tier: "yellow",
        filter: "iron-plate",
        filterSide: "left",
        inputPriority: "left",
        outputPriority: "right",
        nextOutput: ["left", "right"],
        lanesLeft: [[{ item: "iron-plate", pos: 0.4 }], []],
        lanesRight: [[], [{ item: "copper-plate", pos: 0.4 }]],
      },
      {
        id: 5,
        kind: "inserter",
        pos: { x: 5, y: 1 },
        dir: 1,
        type: "inserter",
        filter: "iron-plate",
        swingTicksRemaining: 30,
        swingTotalTicks: 72,
        held: "iron-plate",
        heldCount: 1,
      },
      {
        id: 6,
        kind: "assembler",
        pos: { x: 6, y: 1 },
        dir: 1,
        tier: "am1",
        recipeId: "iron-gear-wheel",
        progress: 0.5,
        inputBuffer: { "iron-plate": 4 },
        outputBuffer: { "iron-gear-wheel": 2 },
        poweredThisTick: true,
      },
      { id: 7, kind: "chest", pos: { x: 9, y: 0 }, tier: "wood", inventory: { "iron-plate": 50 } },
      { id: 8, kind: "item-sink", pos: { x: 9, y: 1 }, dir: 1, totalCount: 42, history: [{ tick: 10, total: 42 }] },
      { id: 9, kind: "item-source", pos: { x: 9, y: 2 }, dir: 1, item: "iron-plate" },
      { id: 10, kind: "pole", pos: { x: 10, y: 3 }, tier: "substation", networkId: 1 },
      { id: 11, kind: "void-chest", pos: { x: 11, y: 0 }, dir: 1, leftCount: 0, rightCount: 0 },
    ];
    for (const e of entities) placeEntity(state, e);
    state.nextId = 12;

    // Set these after placement, not in the literal above — placeEntity itself resets
    // every void-chest's counts on every call (see grid.ts's resetVoidChestBalances),
    // so a nonzero value baked into the literal would already be gone before
    // clearAllItems ever ran; setting it afterward isolates what clearAllItems does.
    const voidChest = state.entities.get(11) as Extract<Entity, { kind: "void-chest" }>;
    voidChest.leftCount = 7;
    voidChest.rightCount = 3;

    clearAllItems(state);

    const belt = state.entities.get(1) as Extract<Entity, { kind: "belt" }>;
    expect(belt.lanes).toEqual([[], []]);

    const ug = state.entities.get(2) as Extract<Entity, { kind: "underground-belt" }>;
    expect(ug.lanes).toEqual([[], []]);
    expect(ug.tunnel).toEqual([[], []]);
    expect(ug.partnerId).toBe(3); // topology (pairing), not an item, stays intact
    expect(ug.role).toBe("entrance");

    const splitter = state.entities.get(4) as Extract<Entity, { kind: "splitter" }>;
    expect(splitter.lanesLeft).toEqual([[], []]);
    expect(splitter.lanesRight).toEqual([[], []]);
    expect(splitter.filter).toBe("iron-plate"); // configuration, not an item, stays intact

    const inserter = state.entities.get(5) as Extract<Entity, { kind: "inserter" }>;
    expect(inserter.held).toBeNull();
    expect(inserter.heldCount).toBe(0);
    expect(inserter.swingTicksRemaining).toBeNull(); // mid-swing state cleared along with the held item
    expect(inserter.filter).toBe("iron-plate"); // configuration stays intact

    const assembler = state.entities.get(6) as Extract<Entity, { kind: "assembler" }>;
    expect(assembler.inputBuffer).toEqual({});
    expect(assembler.outputBuffer).toEqual({});
    expect(assembler.recipeId).toBe("iron-gear-wheel"); // configuration stays intact

    const chest = state.entities.get(7) as Extract<Entity, { kind: "chest" }>;
    expect(chest.inventory).toEqual({});

    const sink = state.entities.get(8) as Extract<Entity, { kind: "item-sink" }>;
    expect(sink.totalCount).toBe(0);
    expect(sink.history).toEqual([]);

    const source = state.entities.get(9) as Extract<Entity, { kind: "item-source" }>;
    expect(source.item).toBe("iron-plate"); // configuration, not a stored item, stays intact

    const pole = state.entities.get(10) as Extract<Entity, { kind: "pole" }>;
    expect(pole.networkId).toBe(1); // power topology stays intact

    expect(voidChest.leftCount).toBe(0);
    expect(voidChest.rightCount).toBe(0);

    expect(state.entities.size).toBe(10); // nothing was placed or removed
  });
});
