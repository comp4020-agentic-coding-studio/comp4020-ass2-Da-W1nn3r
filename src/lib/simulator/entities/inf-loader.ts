// Infinite loader: a testing/debug utility with no real-game counterpart (unlike
// item-source, which stands in for a mining drill's direct-feed mechanic — see
// source-sink.ts's header). Each of its two lanes has its own independently
// configurable item (or null to leave that lane alone), and both lanes are refilled
// unconditionally every tick regardless of each other — the point is to let a layout be
// tested against a belt that's already fully saturated on both lanes at once, which an
// item-source can't do (it shares one item across both lanes and only fills one per
// tick, short-circuited, since it's modelling a single-item drill output).

import { entityAt, recordStat, type SimState } from "../grid";
import { insertIntoLaneBack } from "./belt";
import type { Entity } from "../types";
import { tileAhead } from "../types";

type LaneEntity = Extract<Entity, { kind: "belt" | "underground-belt" }>;

function isLaneEntity(e: Entity | undefined): e is LaneEntity {
  return !!e && (e.kind === "belt" || e.kind === "underground-belt");
}

export function tickInfLoaders(state: SimState): void {
  for (const e of state.entities.values()) {
    if (e.kind !== "inf-loader") continue;
    const dest = entityAt(state, tileAhead(e.pos, e.dir));
    if (!isLaneEntity(dest) || dest.dir !== e.dir) {
      recordStat(state, e.id, "blocked"); // no belt in front to feed
      continue;
    }
    let placedAny = false;
    for (const lane of [0, 1] as const) {
      const item = e.laneItems[lane];
      if (!item) continue;
      if (insertIntoLaneBack(dest, lane, item)) placedAny = true;
    }
    recordStat(state, e.id, placedAny ? "active" : "blocked");
  }
}
