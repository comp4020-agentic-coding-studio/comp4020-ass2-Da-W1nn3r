// Infinite item sources and item-measuring sinks.
//
// An item source behaves like a mining drill depositing directly onto
// whatever's immediately in front of it — no inserter required, matching the
// real mechanic CLAUDE.md's own "game accuracy" note cites (a drill feeds
// forward directly, not through an inserter). An inserter can also pick
// straight off a source (see inserter.ts). An item sink is the mirror
// image: it pulls directly from whatever straight-feeds it, in addition to
// accepting inserter drops.

import { TICKS_PER_SECOND } from "../constants";
import { entityAt, recordStat, type SimState } from "../grid";
import { insertIntoLaneBack, takeLaneFront } from "./belt";
import type { Entity } from "../types";
import { tileAhead, tileBehind } from "../types";

type LaneEntity = Extract<Entity, { kind: "belt" | "underground-belt" }>;

function isLaneEntity(e: Entity | undefined): e is LaneEntity {
  return !!e && (e.kind === "belt" || e.kind === "underground-belt");
}

export function tickSources(state: SimState): void {
  for (const e of state.entities.values()) {
    if (e.kind !== "item-source") continue;
    const dest = entityAt(state, tileAhead(e.pos, e.dir));
    if (!isLaneEntity(dest) || dest.dir !== e.dir) {
      recordStat(state, e.id, "blocked"); // no belt in front to feed
      continue;
    }
    const placed = insertIntoLaneBack(dest, 0, e.item) || insertIntoLaneBack(dest, 1, e.item);
    recordStat(state, e.id, placed ? "active" : "blocked");
  }
}

export function tickSinks(state: SimState): void {
  for (const e of state.entities.values()) {
    if (e.kind !== "item-sink") continue;
    const feeder = entityAt(state, tileBehind(e.pos, e.dir));
    if (!isLaneEntity(feeder) || feeder.dir !== e.dir) {
      recordStat(state, e.id, "starved");
      if (state.tick % TICKS_PER_SECOND === 0) e.history.push({ tick: state.tick, total: e.totalCount });
      continue;
    }
    let received = false;
    for (const lane of [0, 1] as const) {
      const l = feeder.lanes[lane];
      const front = l[l.length - 1];
      if (!front || front.pos < 1 - 1e-6) continue;
      takeLaneFront(feeder, lane);
      e.totalCount += 1;
      received = true;
    }
    recordStat(state, e.id, received ? "active" : "starved");
    if (state.tick % TICKS_PER_SECOND === 0) e.history.push({ tick: state.tick, total: e.totalCount });
  }
}
