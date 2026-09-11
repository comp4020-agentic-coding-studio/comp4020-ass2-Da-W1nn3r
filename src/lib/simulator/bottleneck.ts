// Super-speed bottleneck analysis: this is this tool's own analysis method,
// not a Factorio mechanic to source — standard theory-of-constraints
// reasoning applied to the tick simulation. See entity modules for where
// each active/starved/blocked stat is recorded.
//
// Idea: run the simulation for a batch of ticks with rendering suppressed,
// then look at which tracked entity was busy ("active") on the largest share
// of its ticks. In a real production chain the single slowest step runs flat
// out (rarely starved, rarely blocked) while everything feeding it backs up
// (blocked, nowhere to put its output) and everything downstream of it idles
// (starved, waiting on it) — so the highest utilisation entity is the
// constraint.

import { TICKS_PER_SECOND } from "./constants";
import type { SimState } from "./grid";
import { tickMany } from "./simulate";
import type { BottleneckResult } from "./types";

const DEFAULT_ANALYSIS_TICKS = 3600; // one simulated minute

export function resetStats(state: SimState): void {
  state.stats.clear();
}

/** Run a batch of ticks purely for analysis (chunk this from a caller for idle-callback batching in the UI), then report the constraint. */
export function runBottleneckAnalysis(state: SimState, ticks = DEFAULT_ANALYSIS_TICKS): BottleneckResult {
  resetStats(state);
  const sinkTotalsBefore = new Map<number, number>();
  for (const e of state.entities.values()) {
    if (e.kind === "item-sink") sinkTotalsBefore.set(e.id, e.totalCount);
  }

  tickMany(state, ticks);

  let throughputPerTick = 0;
  for (const e of state.entities.values()) {
    if (e.kind === "item-sink") throughputPerTick += (e.totalCount - (sinkTotalsBefore.get(e.id) ?? 0)) / ticks;
  }
  const throughputPerMinute = throughputPerTick * TICKS_PER_SECOND * 60;

  let bottleneckId: number | null = null;
  let bottleneckUtilisation = -1;
  for (const [id, s] of state.stats) {
    const total = s.activeTicks + s.starvedTicks + s.blockedTicks;
    if (total === 0) continue;
    const utilisation = s.activeTicks / total;
    if (utilisation > bottleneckUtilisation) {
      bottleneckUtilisation = utilisation;
      bottleneckId = id;
    }
  }

  if (bottleneckId === null) {
    return {
      entityId: null,
      utilisation: 0,
      reason: "No tracked activity — check the layout has a connected, powered path from a source to a sink.",
      throughputPerMinute,
    };
  }

  const entity = state.entities.get(bottleneckId);
  const kind = entity?.kind ?? "component";
  const pct = Math.round(bottleneckUtilisation * 100);
  const reason =
    bottleneckUtilisation >= 0.95
      ? `This ${kind} was active on ${pct}% of ticks — everything feeding it is backing up and everything after it is starved. This is the bottleneck.`
      : `This ${kind} had the highest utilisation of any tracked component (${pct}%), but nothing is fully saturated — check for a disconnected, unpowered, or unfiltered section rather than a single constraint.`;

  return { entityId: bottleneckId, utilisation: bottleneckUtilisation, reason, throughputPerMinute };
}
