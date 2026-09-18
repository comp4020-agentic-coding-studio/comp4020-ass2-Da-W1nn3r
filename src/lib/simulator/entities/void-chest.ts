// Void chest: a testing/debug utility with no real-game counterpart, grouped in the
// palette under "Loaders" alongside inf-loader (see that file's header) because it's
// that entity's drain-side mirror rather than a production sink like item-sink. Every
// tick it wipes whatever's on the tile immediately behind it clean — both lanes,
// every item on them, not just a front-most item that's reached the exit edge — so
// the belt feeding it is always fully desaturated and can never back up regardless of
// throughput. It also tallies how many items it has drained from each lane
// separately, which lets a layout be checked for left/right balance.

import { entityAt, recordStat, type SimState } from "../grid";
import type { Entity, VoidChestEntity } from "../types";
import { tileBehind } from "../types";

type LaneEntity = Extract<Entity, { kind: "belt" | "underground-belt" }>;

function isLaneEntity(e: Entity | undefined): e is LaneEntity {
  return !!e && (e.kind === "belt" || e.kind === "underground-belt");
}

export function tickVoidChests(state: SimState): void {
  for (const e of state.entities.values()) {
    if (e.kind !== "void-chest") continue;
    const feeder = entityAt(state, tileBehind(e.pos, e.dir));
    if (!isLaneEntity(feeder) || feeder.dir !== e.dir) {
      recordStat(state, e.id, "starved");
      continue;
    }
    let drainedAny = false;
    for (const lane of [0, 1] as const) {
      const l = feeder.lanes[lane];
      if (l.length === 0) continue;
      if (lane === 0) e.leftCount += l.length;
      else e.rightCount += l.length;
      l.length = 0;
      drainedAny = true;
    }
    recordStat(state, e.id, drainedAny ? "active" : "starved");
  }
}

export type VoidChestBalance = "balanced" | "left-heavy" | "right-heavy";

/** Judges left/right balance from the running per-lane totals. Tolerates a small
 * relative difference (5% of everything drained so far) rather than requiring exact
 * equality, since even a perfectly balanced feed won't land both lanes on the same
 * count tick-for-tick. Reads as "balanced" before anything has been drained yet. */
export function voidChestBalance(e: VoidChestEntity): VoidChestBalance {
  const total = e.leftCount + e.rightCount;
  if (total === 0) return "balanced";
  const diff = e.leftCount - e.rightCount;
  if (Math.abs(diff) / total < 0.05) return "balanced";
  return diff > 0 ? "left-heavy" : "right-heavy";
}
