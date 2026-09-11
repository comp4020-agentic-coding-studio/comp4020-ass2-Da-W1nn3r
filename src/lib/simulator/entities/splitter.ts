// Splitter tick simulation: two side-by-side belt-like columns that can
// hand items to *either* column's output, giving 1:1 balancing by default,
// or filter/priority routing when configured. Runs after tickBelts each
// simulation tick.
//
// Scope cut: a splitter's input pull only accepts a straight feed (directly
// behind each column, facing the same direction), not a perpendicular
// sideload the way a plain belt tile does — the task brief's T-junction note
// was specifically about belts and underground belts, not splitters, and
// real splitters are always placed as a straight two-wide unit.
//
// Movement and exit are computed with the same front-to-back "ceiling" pass
// belt.ts uses (see its header comment), except the destination for an
// exiting item is resolved dynamically per item (filter/priority/balance)
// rather than precomputed, since a splitter's two columns can send to either
// output.

import { BELT_MIN_ITEM_GAP, TICKS_PER_SECOND, beltLaneSpeedTilesPerSecond } from "../constants";
import type { SimState } from "../grid";
import { entityAt } from "../grid";
import { insertIntoLaneBack, takeLaneFront } from "./belt";
import type { BeltItem, BeltLanes, Entity, ItemId, SplitterEntity, Vec2 } from "../types";
import { tileAhead, tileBehind } from "../types";

type LaneEntity = Extract<Entity, { lanes: BeltLanes }>;
export type Column = "left" | "right";

function isLaneEntity(e: Entity | undefined): e is LaneEntity {
  return !!e && (e.kind === "belt" || e.kind === "underground-belt");
}

function laneSpeedPerTick(entity: SplitterEntity): number {
  return beltLaneSpeedTilesPerSecond(entity.tier) / TICKS_PER_SECOND;
}

/** Tile position of a column's own tile (left = `pos`, right = one tile further, perpendicular to `dir`). */
function columnPos(entity: SplitterEntity, column: Column): Vec2 {
  if (column === "left") return entity.pos;
  const perpendicular = entity.dir % 2 === 0 ? { x: 1, y: 0 } : { x: 0, y: 1 };
  return { x: entity.pos.x + perpendicular.x, y: entity.pos.y + perpendicular.y };
}

function lanesOf(entity: SplitterEntity, column: Column): BeltLanes {
  return column === "left" ? entity.lanesLeft : entity.lanesRight;
}

/** Which column (if any) of a splitter occupies tile `pos` — used by inserters picking up/dropping directly onto a splitter half-tile. */
export function columnAt(entity: SplitterEntity, pos: Vec2): Column | null {
  const left = columnPos(entity, "left");
  if (pos.x === left.x && pos.y === left.y) return "left";
  const right = columnPos(entity, "right");
  if (pos.x === right.x && pos.y === right.y) return "right";
  return null;
}

function frontIsReady(lane: BeltItem[]): boolean {
  const front = lane[lane.length - 1];
  return !!front && front.pos >= 1 - 1e-6;
}

/** Pull one ready item per lane from directly behind `column`, if room allows. */
function pullFrom(state: SimState, entity: SplitterEntity, column: Column): void {
  const behindPos = tileBehind(columnPos(entity, column), entity.dir);
  const feeder = entityAt(state, behindPos);
  if (!isLaneEntity(feeder) || feeder.dir !== entity.dir) return;
  const lanes = lanesOf(entity, column);
  for (const laneIndex of [0, 1] as const) {
    if (!frontIsReady(feeder.lanes[laneIndex])) continue;
    const back = lanes[laneIndex][0];
    if (back && back.pos < BELT_MIN_ITEM_GAP) continue;
    const front = takeLaneFront(feeder, laneIndex);
    if (front) lanes[laneIndex].unshift({ item: front.item, pos: 0 });
  }
}

/** Candidate exit columns for one item, most preferred first. */
function targetOrder(entity: SplitterEntity, itemId: ItemId, laneIndex: 0 | 1): Column[] {
  if (entity.filter) {
    // Filter is strict: the matching item always goes to its assigned side,
    // everything else to the other side — even if that side is jammed
    // (matches the real splitter's behaviour of backing up rather than
    // rerouting a filtered item).
    return [itemId === entity.filter ? entity.filterSide : oppositeColumn(entity.filterSide)];
  }
  if (entity.outputPriority !== "none") {
    const preferred = entity.outputPriority;
    return [preferred, oppositeColumn(preferred)];
  }
  // Balance mode: per wiki.factorio.com/Belt_transport_system's Splitters section, "it
  // will split the input evenly between its two outputs", and "if one of the outputs is
  // fully backed-up and the splitter cannot split evenly, it will put all input on its
  // other output" — a 1:1 round-robin per lane, not a comparison of which side currently
  // has more downstream room (that only diverts when the two sides already differ, so
  // ties — the common case when both are empty — always fell through to the same side
  // and never actually split anything).
  const preferred = entity.nextOutput[laneIndex];
  return [preferred, oppositeColumn(preferred)];
}

function oppositeColumn(c: Column): Column {
  return c === "left" ? "right" : "left";
}

function pushTo(state: SimState, entity: SplitterEntity, column: Column, laneIndex: 0 | 1, item: ItemId): boolean {
  const dest = entityAt(state, tileAhead(columnPos(entity, column), entity.dir));
  if (!isLaneEntity(dest)) return false;
  return insertIntoLaneBack(dest, laneIndex, item);
}

export function tickSplitters(state: SimState): void {
  const splitters: SplitterEntity[] = [];
  for (const e of state.entities.values()) if (e.kind === "splitter") splitters.push(e);

  for (const entity of splitters) {
    entity.nextOutput ??= ["left", "left"]; // migrate saves from before round-robin balancing existed.
    pullFrom(state, entity, "left");
    pullFrom(state, entity, "right");

    const order: Column[] =
      entity.inputPriority === "left" ? ["left", "right"] : entity.inputPriority === "right" ? ["right", "left"] : ["left", "right"];

    for (const column of order) {
      const speed = laneSpeedPerTick(entity);
      const lanes = lanesOf(entity, column);
      for (const laneIndex of [0, 1] as const) {
        const lane = lanes[laneIndex];
        const kept: BeltItem[] = [];
        let ceiling = Infinity;
        for (let i = lane.length - 1; i >= 0; i--) {
          const item = lane[i];
          const isFront = i === lane.length - 1;
          const localCeiling = isFront ? Infinity : ceiling - BELT_MIN_ITEM_GAP;
          const newPos = Math.min(item.pos + speed, Math.max(item.pos, localCeiling));
          if (isFront && newPos >= 1) {
            const candidates = targetOrder(entity, item.item, laneIndex);
            const placed = candidates.some((candidate) => pushTo(state, entity, candidate, laneIndex, item.item));
            if (placed) {
              if (!entity.filter && entity.outputPriority === "none") {
                // Advance the round-robin unconditionally (not to whichever side actually
                // received the item) so a jammed preferred side keeps deferring to the
                // other side on every attempt, and strict 1:1 alternation resumes on its
                // own once that side frees up again.
                entity.nextOutput[laneIndex] = oppositeColumn(entity.nextOutput[laneIndex]);
              }
              ceiling = 1;
              continue;
            }
            kept.unshift({ item: item.item, pos: 1 });
            ceiling = 1;
          } else {
            kept.unshift({ item: item.item, pos: newPos });
            ceiling = newPos;
          }
        }
        lanes[laneIndex] = kept;
      }
    }
  }
}
