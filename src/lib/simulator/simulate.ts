// Master fixed-timestep tick loop, 60 ticks/second to match the game (so the
// ticks-per-cycle constants in constants.ts plug in directly).
//
// Update order: power -> assemblers -> inserters -> belts/splitters ->
// sources/sinks/inf-loaders. Power goes first so everything downstream sees this tick's
// supply state; sources/sinks/inf-loaders go last so an item placed by an inserter or
// belt this tick isn't immediately eligible for a second hop before the
// next tick.

import { resolveUndergroundPartners, tickBelts } from "./entities/belt";
import { tickSplitters } from "./entities/splitter";
import { tickInserters } from "./entities/inserter";
import { tickAssemblers } from "./entities/assembler";
import { tickPower } from "./entities/power";
import { tickSinks, tickSources } from "./entities/source-sink";
import { tickInfLoaders } from "./entities/inf-loader";
import type { SimState } from "./grid";

export function tick(state: SimState): void {
  tickPower(state);
  tickAssemblers(state);
  tickInserters(state);
  resolveUndergroundPartners(state);
  tickBelts(state);
  tickSplitters(state);
  tickSources(state);
  tickSinks(state);
  tickInfLoaders(state);
  state.tick += 1;
}

/** Run `count` ticks back to back, e.g. for a manual "step" or super-speed batch. */
export function tickMany(state: SimState, count: number): void {
  for (let i = 0; i < count; i++) tick(state);
}
