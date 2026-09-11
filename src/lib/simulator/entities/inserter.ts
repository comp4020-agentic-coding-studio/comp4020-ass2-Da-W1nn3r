// Inserter tick simulation: a per-inserter pickup/swing/drop state machine.
//
// The full pickup-to-drop swing time is INSERTER_CYCLE_TICKS[type] (see
// constants.ts for sourcing); an inserter grabs its item(s) the instant a
// valid pickup is available (see tryPickup: instant full stack size from a
// chest-like source, one item per swing off a belt/splitter since a belt
// slot never holds more than one item), then counts down the swing.
//
// Once the swing reaches the drop point, a multi-item hand (a stack
// inserter's chest-sourced grab) doesn't get placed in one shot: tryDrop
// places exactly one item per call at a belt/splitter destination, and the
// inserter keeps retrying every following tick — gated only by belt-gap
// room, not swing timing — until the hand is empty, which is what lets it
// saturate a belt lane. A chest-like destination (assembler/sink/chest) still
// takes the whole hand in one tick, matching real chest-to-chest transfer.
// If the drop destination has no room, the inserter freezes holding
// the item(s) and retries every subsequent tick — it does not return empty.
//
// Smart pickup off a mixed belt: when no explicit filter is set and the drop
// destination is an assembler with a recipe chosen, tryPickup additionally
// restricts itself to that recipe's ingredients that the input buffer doesn't
// already have enough of (see recipeIngredientFilter) — a real inserter
// behaviour (wiki.factorio.com/Inserters): it won't keep loading an ingredient
// the machine already has plenty of while a different one sits unfed.
//
// Idle empty-handed unless dripping onto a belt: every tryPickup branch also
// checks destinationRoomFor before grabbing anything. For a fixed-capacity
// destination (assembler input buffer, chest, or no destination at all) this
// means an inserter simply won't pick up an item it has nowhere to put, rather
// than grabbing it and freezing mid-swing forever. A belt/underground
// belt/splitter destination is exempt — dropping onto one always happens one
// item per tick regardless of hand size (see below), so holding an item while
// waiting for belt-gap room to open up is normal, expected behaviour there,
// not a stuck inserter.
//
// Near/far lane bonus: only applies when picking off a belt/underground belt
// tile positioned to one side of the inserter (a well-defined "near" lane)
// AND that belt is currently stalled (see constants.ts's citation). When the
// pickup tile is in line with the inserter's own facing axis, near/far is
// ambiguous in this simplified model and no bonus is applied — a deliberate
// scope cut rather than a fabricated tie-break.
//
// Pickup vs. drop lane choice is asymmetric (wiki.factorio.com/inserters):
// picking up prefers the near lane but can still reach the far one, while
// dropping off can ONLY ever reach one fixed lane — the far lane when
// sideloading, or the belt's own right lane when dropping in line — with no
// fallback to the other lane if it's blocked.
//
// Power: only the burner inserter runs on fuel rather than electricity, so
// it's exempt from the power check every other inserter type gets.

import {
  INSERTER_CYCLE_TICKS,
  INSERTER_REACH,
  INSERTER_STACK_SIZE,
  NEAR_LANE_SPEED_BONUS,
  RECIPES,
  BELT_MIN_ITEM_GAP,
} from "../constants";
import type { SimState } from "../grid";
import { entityAt, recordStat } from "../grid";
import { insertIntoLaneBack, isLaneStalled, peekLaneFront, takeLaneFront } from "./belt";
import { chestInsert, chestRoomFor, chestTake } from "./chest";
import { ingredientInputCap } from "./assembler";
import { isEntityPowered } from "./power";
import { columnAt } from "./splitter";
import type { Direction, InserterEntity, ItemId, Vec2 } from "../types";
import { DIR_DELTA, oppositeDir, relativeSide } from "../types";

function posAtReach(pos: Vec2, dir: Direction, reach: number, sign: 1 | -1): Vec2 {
  const d = DIR_DELTA[dir];
  return { x: pos.x + d.x * reach * sign, y: pos.y + d.y * reach * sign };
}

function pickupPos(entity: InserterEntity): Vec2 {
  return posAtReach(entity.pos, entity.dir, INSERTER_REACH[entity.type], -1);
}

function dropPos(entity: InserterEntity): Vec2 {
  return posAtReach(entity.pos, entity.dir, INSERTER_REACH[entity.type], 1);
}

function otherLane(li: 0 | 1): 0 | 1 {
  return li === 0 ? 1 : 0;
}

/** The belt/splitter lane nearest the inserter, given the compass direction the inserter's own
 * tile actually sits at relative to the target (NOT always `entity.dir`: a pickup tile is behind
 * the inserter, so the inserter's physical side there is `entity.dir` itself, but a drop tile is
 * ahead of it, so the inserter's physical side there is `oppositeDir(entity.dir)` instead — see
 * callers). Null when that side is in line with the belt's own axis (ambiguous). */
function nearLaneIndexFor(beltDir: Direction, physicalSide: Direction): (0 | 1) | null {
  const side = relativeSide(beltDir, physicalSide);
  if (side === -1) return 0;
  if (side === 1) return 1;
  return null;
}

interface PickupResult {
  item: ItemId;
  count: number;
  nearBonus: boolean;
}

/** How many more of `item` the inserter's current drop destination has room for right
 * now — the gate every tryPickup branch checks before grabbing anything (see this file's
 * header, "Idle empty-handed unless dripping onto a belt"). A belt/underground-belt/
 * splitter destination returns Infinity: it only ever accepts one item per tick no matter
 * how large the inserter's hand is (see tryDrop), so a held item waiting for belt-gap room
 * to open up is normal, not a stuck inserter. An item-sink is an unlimited stand-in
 * (see source-sink.ts) so it's Infinity too. An assembler only has room for an item that's
 * actually one of its current recipe's ingredients, capped by ingredientInputCap — this is
 * also what makes an unfiltered inserter stop loading an ingredient the buffer is already
 * full of and pick up whatever the recipe still needs instead (wiki.factorio.com/Inserters).
 * No destination at all (nothing placed, or placed but not a valid drop target) is 0. */
function destinationRoomFor(state: SimState, entity: InserterEntity, item: ItemId): number {
  const dest = entityAt(state, dropPos(entity));
  if (!dest) return 0;
  switch (dest.kind) {
    case "belt":
    case "underground-belt":
    case "splitter":
    case "item-sink":
      return Infinity;
    case "assembler": {
      if (!dest.recipeId) return 0;
      const recipe = RECIPES.find((r) => r.id === dest.recipeId);
      const ingredient = recipe?.ingredients.find((i) => i.item === item);
      if (!recipe || !ingredient) return 0;
      const have = dest.inputBuffer[item] ?? 0;
      return Math.max(0, ingredientInputCap(recipe, item) - have);
    }
    case "chest":
      return chestRoomFor(dest, item);
    default:
      return 0;
  }
}

function tryPickup(state: SimState, entity: InserterEntity): PickupResult | null {
  const pos = pickupPos(entity);
  const source = entityAt(state, pos);
  if (!source) return null;
  const stackSize = INSERTER_STACK_SIZE[entity.type];

  switch (source.kind) {
    case "item-source": {
      if (entity.filter && entity.filter !== source.item) return null;
      const room = destinationRoomFor(state, entity, source.item);
      if (room <= 0) return null;
      return { item: source.item, count: Math.min(stackSize, room), nearBonus: false };
    }
    case "belt":
    case "underground-belt": {
      // A belt slot holds exactly one item (see belt.ts's header) — even a stack inserter's
      // large hand can only ever find one item waiting at the pickup point per swing, so
      // filling a hand of `stackSize` off a belt costs one full swing per item, same as a
      // regular inserter. That's the "delay between pick up" from a belt the stack inserter
      // has, in contrast to the instant full-stack grab it gets from a chest-like source below.
      // Pickup tile is behind the inserter, so the inserter's own physical side of it is
      // `entity.dir` directly (see nearLaneIndexFor's doc comment).
      const near = nearLaneIndexFor(source.dir, entity.dir);
      const order: (0 | 1)[] = near !== null ? [near, otherLane(near)] : [0, 1];
      for (const li of order) {
        const front = peekLaneFront(source, li);
        if (!front) continue;
        if (entity.filter && entity.filter !== front.item) continue;
        if (destinationRoomFor(state, entity, front.item) <= 0) continue;
        const bonus = near !== null && li === near && isLaneStalled(source, li);
        takeLaneFront(source, li);
        return { item: front.item, count: 1, nearBonus: bonus };
      }
      return null;
    }
    case "splitter": {
      // Same one-item-per-slot reasoning as the belt case above, and same near-side
      // preference (a splitter column's two lanes sit side by side within the tile just
      // like a belt's do).
      const column = columnAt(source, pos);
      if (!column) return null;
      const lanes = column === "left" ? source.lanesLeft : source.lanesRight;
      const near = nearLaneIndexFor(source.dir, entity.dir);
      const order: (0 | 1)[] = near !== null ? [near, otherLane(near)] : [0, 1];
      for (const li of order) {
        const lane = lanes[li];
        const front = lane[lane.length - 1];
        if (!front || front.pos < 1 - 1e-6) continue;
        if (entity.filter && entity.filter !== front.item) continue;
        if (destinationRoomFor(state, entity, front.item) <= 0) continue;
        lane.pop();
        return { item: front.item, count: 1, nearBonus: false };
      }
      return null;
    }
    case "assembler": {
      for (const item of Object.keys(source.outputBuffer)) {
        if (entity.filter && entity.filter !== item) continue;
        const available = source.outputBuffer[item] ?? 0;
        if (available <= 0) continue;
        const room = destinationRoomFor(state, entity, item);
        if (room <= 0) continue;
        const take = Math.min(available, stackSize, room);
        if (take <= 0) continue;
        source.outputBuffer[item] = available - take;
        return { item, count: take, nearBonus: false };
      }
      return null;
    }
    case "chest": {
      // Whole-hand instant grab, same as an assembler's output buffer above — a chest is
      // another chest-like source in this simulator's own terms (see this file's header).
      for (const item of Object.keys(source.inventory)) {
        if (entity.filter && entity.filter !== item) continue;
        const room = destinationRoomFor(state, entity, item);
        if (room <= 0) continue;
        const taken = chestTake(source, item, Math.min(stackSize, room));
        if (taken > 0) return { item, count: taken, nearBonus: false };
      }
      return null;
    }
    default:
      return null;
  }
}

/** Attempts to place held items at the drop point; returns how many were actually placed (0 if
 * blocked). A belt/splitter destination can only ever accept one item per slot, so this places
 * exactly one at a time there regardless of how many the inserter is holding — the caller keeps
 * calling this every tick until the hand empties, which is what lets a stack inserter's drop-off
 * saturate a belt lane at the belt's own pace rather than being paced by inserter swing timing.
 * A chest-like destination (assembler/sink) takes the whole held stack in one tick instead,
 * matching the real game's instant chest-to-chest transfer. */
function tryDrop(state: SimState, entity: InserterEntity): number {
  const held = entity.held;
  if (!held) return 0;
  const count = entity.heldCount;
  const pos = dropPos(entity);
  const dest = entityAt(state, pos);
  if (!dest) return 0;

  switch (dest.kind) {
    case "belt":
    case "underground-belt": {
      // wiki.factorio.com/inserters: an inserter dropping onto a belt "only places items
      // onto one side of the belt, either the far side from the inserter's perspective, or,
      // if the belt is going the same or the opposite direction as the inserter, the right
      // side from the belt's perspective" — a fixed lane, never a near-then-far fallback (a
      // sideloading inserter can never reach its own near lane at all). Drop tile is ahead of
      // the inserter, so the inserter's own physical side of it is `oppositeDir(entity.dir)`,
      // not `entity.dir` (see nearLaneIndexFor's doc comment); `near` is null when dropping
      // in line with the belt's own axis, where "near/far" isn't meaningful and the fixed
      // target is the belt's own right lane (lane 1) instead.
      const near = nearLaneIndexFor(dest.dir, oppositeDir(entity.dir));
      const target = near !== null ? otherLane(near) : 1;
      return insertIntoLaneBack(dest, target, held) ? 1 : 0;
    }
    case "splitter": {
      // Same fixed far-lane-only rule as the belt case above (a splitter column's two lanes
      // sit side by side within the tile just like a belt's do).
      const column = columnAt(dest, pos);
      if (!column) return 0;
      const lanes = column === "left" ? dest.lanesLeft : dest.lanesRight;
      const near = nearLaneIndexFor(dest.dir, oppositeDir(entity.dir));
      const target = near !== null ? otherLane(near) : 1;
      const lane = lanes[target];
      if (lane.length === 0 || lane[0].pos >= BELT_MIN_ITEM_GAP) {
        lane.unshift({ item: held, pos: 0 });
        return 1;
      }
      return 0;
    }
    case "assembler": {
      if (!dest.recipeId) return 0;
      const recipe = RECIPES.find((r) => r.id === dest.recipeId);
      const ingredient = recipe?.ingredients.find((i) => i.item === held);
      if (!recipe || !ingredient) return 0;
      const cap = ingredientInputCap(recipe, held);
      const have = dest.inputBuffer[held] ?? 0;
      if (have >= cap) return 0;
      // tryPickup already caps what an inserter grabs at destinationRoomFor, but clamp
      // here too rather than trust that held: another inserter feeding the same buffer
      // this same tick could have used up the room in between.
      const accepted = Math.min(count, cap - have);
      dest.inputBuffer[held] = have + accepted;
      return accepted;
    }
    case "item-sink": {
      dest.totalCount += count;
      dest.history.push({ tick: state.tick, total: dest.totalCount });
      return count;
    }
    case "chest": {
      // Whole held stack in one tick, matching the real game's instant chest-to-chest
      // transfer (same as the assembler case above); chestInsert already caps this by
      // remaining slots, so a full chest simply accepts a partial amount (or none).
      return chestInsert(dest, held, count);
    }
    default:
      return 0;
  }
}

export function tickInserters(state: SimState): void {
  for (const entity of state.entities.values()) {
    if (entity.kind !== "inserter") continue;
    const inserter: InserterEntity = entity;
    if (inserter.type !== "burner" && !isEntityPowered(state, inserter)) continue;

    if (inserter.swingTicksRemaining === null) {
      const picked = tryPickup(state, inserter);
      if (!picked) {
        recordStat(state, inserter.id, "starved"); // nothing valid to pick up
        continue;
      }
      inserter.held = picked.item;
      inserter.heldCount = picked.count;
      const base = INSERTER_CYCLE_TICKS[inserter.type];
      const total = picked.nearBonus ? Math.round(base * (1 - NEAR_LANE_SPEED_BONUS)) : base;
      inserter.swingTotalTicks = total;
      inserter.swingTicksRemaining = total;
      recordStat(state, inserter.id, "active");
      continue;
    }

    if (inserter.swingTicksRemaining > 0) {
      inserter.swingTicksRemaining -= 1;
      recordStat(state, inserter.id, "active");
      continue;
    }

    // Arrived at the drop point: place as much of the hand as tryDrop allows this tick
    // (one item at a belt/splitter, the whole hand at a chest-like destination) and keep
    // retrying next tick until nothing's left, then return to idle for a new pickup.
    const dropped = tryDrop(state, inserter);
    if (dropped > 0) {
      inserter.heldCount -= dropped;
      recordStat(state, inserter.id, "active");
      if (inserter.heldCount <= 0) {
        inserter.held = null;
        inserter.heldCount = 0;
        inserter.swingTicksRemaining = null;
      }
    } else {
      recordStat(state, inserter.id, "blocked"); // held item(s), nowhere to drop them yet
    }
  }
}
