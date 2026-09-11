// Belt and underground-belt tick simulation.
//
// Movement uses a snapshot ("double buffer") update: every belt-like tile
// computes how far its front item can advance this tick using the *previous*
// tick's state of whatever is downstream, then all results are committed
// together. This sidesteps update-order bugs entirely (real Factorio's own
// sideloading priority is famously order-dependent and "won't fix" — see the
// plan's citations) at the cost of a one-tick lag at tile boundaries, which
// is imperceptible at 60 ticks/second.
//
// Corners vs. merges: a plain corner turn — entity is dest's ONLY feeder —
// preserves both of the feeder's lanes onto the two lanes of the turn,
// left-to-left and right-to-right, since a belt's left rail never crosses to
// the right rail mid-bend (dest "becomes a bend"). The moment dest has ANY
// other feeder too — a straight one behind it, or another sideloader on its
// opposite perpendicular side — dest can no longer act as a single bend
// (it's a genuine merge/T-junction instead), so every sideloading feeder's
// two lanes collapse onto the ONE destination lane nearer its own side
// (matching the real game's belt-transport-system behaviour); a straight
// feeder, if present, keeps passing straight through unaffected.
//
// Underground belt entrances/exits are a hard exception to the plain-corner
// rule, even as dest's only feeder: forums.factorio.com/viewtopic.php?t=60991
// ("because there is no path onto the underground belt, only the outer side
// of the corner can enter") and wiki.factorio.com/Belt_transport_system
// ("the half of the underground belt tile with a belt can accept input from
// the side, the other half — with a tunnel entrance — blocks incoming
// items") both describe the tunnel "hood" as physically covering one whole
// lane's half of the tile. So a sideloader's OUTER lane (the one that sweeps
// the wider arc through the turn — left lane on a clockwise/right turn,
// right lane on a counter-clockwise/left turn) is the only one with a path
// in; its inner lane has nowhere to go and simply can't advance, backing up
// on the feeder. This is also the documented basis for the classic
// lane-splitting trick: sideloading each lane of a mixed belt onto a
// separate underground entrance/exit to split them without a splitter.
//
// A merged feeder's own two lanes then contend for that single collapsed
// destination lane: the feeder's lane on the OPPOSITE side from the lane it
// collapses onto has priority (e.g. a feeder collapsing onto the destination's
// right lane has its own left lane go first) — the other lane defers to the
// next tick rather than also squeezing through the same tick, per the user's
// reported in-game behaviour.

import { BELT_MIN_ITEM_GAP, TICKS_PER_SECOND, UNDERGROUND_BELT_MAX_GAP, beltLaneSpeedTilesPerSecond } from "../constants";
import type { SimState } from "../grid";
import { entityAt } from "../grid";
import type { BeltEntity, BeltItem, BeltLanes, BeltTier, Direction, Entity, ItemId, UndergroundBeltEntity, Vec2 } from "../types";
import { DIR_DELTA, addVec, oppositeDir, relativeSide, tileAhead, tileBehind } from "../types";

type LaneHolder = BeltEntity | UndergroundBeltEntity;

function isLaneHolder(e: Entity | undefined): e is LaneHolder {
  return !!e && (e.kind === "belt" || e.kind === "underground-belt");
}

function laneSpeedPerTick(e: LaneHolder): number {
  return beltLaneSpeedTilesPerSecond(e.tier) / TICKS_PER_SECOND;
}

interface DestRef {
  entity: LaneHolder;
  lane: 0 | 1;
}

/** Is `feeder` a straight, behind-the-back feeder for `dest`? */
function isStraightFeeder(feeder: Entity, dest: LaneHolder): boolean {
  return feeder !== dest && "dir" in feeder && (feeder as LaneHolder).dir === dest.dir;
}

function feedsInto(feeder: LaneHolder, dest: LaneHolder): boolean {
  const ahead = tileAhead(feeder.pos, feeder.dir);
  return ahead.x === dest.pos.x && ahead.y === dest.pos.y;
}

/** True if some lane-holder OTHER than `entity` also feeds into `dest` this tick —
 * straight from behind, or sideloading from dest's other perpendicular side. That's
 * what makes dest a genuine merge rather than a plain corner turn with `entity` as
 * its only feeder (a lone side feeder can act as a bend; a second feeder of any kind
 * means dest can't collapse into a single bend, so every sideloader must pick a lane). */
function hasCompetingFeeder(state: SimState, entity: LaneHolder, dest: LaneHolder): boolean {
  for (const dir of [0, 1, 2, 3] as const) {
    const neighbor = entityAt(state, addVec(dest.pos, DIR_DELTA[dir]));
    if (!isLaneHolder(neighbor) || neighbor === entity) continue;
    if (feedsInto(neighbor, dest)) return true;
  }
  return false;
}

/** Resolve where a lane-holder's front item goes when it crosses its exit edge. */
function resolveDestination(state: SimState, entity: LaneHolder, lane: 0 | 1): DestRef | null {
  if (entity.kind === "underground-belt" && entity.role === "entrance") {
    return null; // handled by the tunnel, not the grid.
  }
  const aheadPos = tileAhead(entity.pos, entity.dir);
  const dest = entityAt(state, aheadPos);
  if (!isLaneHolder(dest)) return null;

  if (isStraightFeeder(entity, dest)) {
    return { entity: dest, lane };
  }

  // Sideload: entity points into dest from one of dest's perpendicular sides.
  const side = relativeSide(dest.dir, oppositeDir(entity.dir));
  if (side === 0) return null; // pointing straight at dest but not aligned behind it — ignore.

  if (dest.kind === "underground-belt") {
    // The tunnel hood blocks one whole lane's half of the tile regardless of
    // whether this is dest's only feeder — see the module header. The outer
    // lane of the turn (the one sweeping the wider arc) is the feeder's left
    // lane on a clockwise turn (side === 1, i.e. entity is to dest's right)
    // and its right lane on a counter-clockwise turn (side === -1) — and, as
    // with any plain corner, the outer lane's identity carries straight
    // through onto dest's matching lane index.
    const outerLane: 0 | 1 = side === 1 ? 0 : 1;
    if (lane !== outerLane) return null; // inner lane: no path in, backs up on the feeder.
    return { entity: dest, lane };
  }

  let destLane: 0 | 1;
  if (hasCompetingFeeder(state, entity, dest)) {
    // Genuine merge: dest has another feeder too (straight behind, or sideloading from
    // the opposite side), so it can't act as a single bend — this sideloader's lanes
    // collapse onto the one lane nearer its own side: left side feeds lane 0, right
    // side feeds lane 1. (Each side is upstream of, and takes priority over, only its
    // own near lane — the two sideloaders on opposite sides never contend for the
    // same lane.)
    destLane = side === -1 ? 0 : 1;
  } else {
    // Plain corner turn (entity is dest's only feeder): a belt's left/right lane
    // identity carries straight through any bend, left or right — the curve's
    // pivot side is, by definition, fixed on one side of the direction of travel
    // for the whole arc, so the left rail never crosses to become the right rail.
    // Confirmed against current in-game behavior: an eastbound belt's north (left)
    // lane turning into a southbound belt lands on the southbound belt's east
    // (left) lane, not swapped onto the west (right) lane.
    destLane = lane;
  }
  return { entity: dest, lane: destLane };
}

/** Every lane-holder feeding `dest`'s given lane this tick, straight feeder first. */
function candidateFeeders(state: SimState, dest: LaneHolder, lane: 0 | 1, all: LaneHolder[]): LaneHolder[] {
  const straight: LaneHolder[] = [];
  const side: LaneHolder[] = [];
  for (const feeder of all) {
    const resolved = resolveDestination(state, feeder, 0);
    const resolvedOther = resolveDestination(state, feeder, 1);
    const hits = [resolved, resolvedOther].some((r) => r && r.entity === dest && r.lane === lane);
    if (!hits) continue;
    if (isStraightFeeder(feeder, dest)) straight.push(feeder);
    else side.push(feeder);
  }
  return [...straight, ...side];
}

interface PendingArrival {
  lane: 0 | 1;
  item: ItemId;
  pos: number;
}

function frontOf(lane: BeltItem[]): BeltItem | undefined {
  return lane[lane.length - 1];
}

/** Room, expressed as a "virtual" ceiling in [1, +Inf), for an item crossing into `lane`. */
function destRoom(lane: BeltItem[]): number {
  if (lane.length === 0) return Infinity;
  const nearestToEntry = lane[0].pos;
  return 1 + Math.max(0, nearestToEntry - BELT_MIN_ITEM_GAP);
}

export function tickBelts(state: SimState): void {
  const holders: LaneHolder[] = [];
  for (const e of state.entities.values()) if (isLaneHolder(e)) holders.push(e);

  const winner = new Map<string, LaneHolder>(); // `${destId}:${lane}` -> winning feeder
  const reservedRoom = new Map<string, number>();

  for (const dest of holders) {
    for (const lane of [0, 1] as const) {
      const key = `${dest.id}:${lane}`;
      const candidates = candidateFeeders(state, dest, lane, holders);
      if (candidates.length === 0) continue;
      const chosen =
        candidates.length === 1
          ? candidates[0]
          : candidates[state.tick % candidates.length]; // straight feeder is index 0 and near-always wins; ties among sideloaders alternate for fairness, matching the real game's lack of a fixed sideload priority.
      winner.set(key, chosen);
      reservedRoom.set(key, destRoom(dest.lanes[lane]));
    }
  }

  const arrivals = new Map<number, PendingArrival[]>();
  const newLanes = new Map<number, BeltLanes>();

  for (const entity of holders) {
    const lanes: BeltLanes = [[], []];
    const dest0 = resolveDestination(state, entity, 0);
    const dest1 = resolveDestination(state, entity, 1);
    // When both of this feeder's own lanes collapse onto the SAME destination lane (a
    // genuine merge, per resolveDestination's merge branch), the feeder's own lane on the
    // opposite side from the collapsed lane gets first claim on the shared room — e.g. an
    // eastbound feeder collapsing onto a destination's right lane has its own left lane take
    // priority over its own right lane, matching the reported in-game priority (each lane is
    // "upstream" of, and wins over, the other). A plain corner or straight-through belt sends
    // its two lanes to two different destination lanes, so this never applies there.
    const collapsedOnto = dest0 && dest1 && dest0.entity === dest1.entity && dest0.lane === dest1.lane ? dest0.lane : null;
    const laneOrder: readonly (0 | 1)[] = collapsedOnto === 0 ? [1, 0] : [0, 1];
    // True once the priority lane of a collapsed pair has claimed the shared destination
    // lane this tick — the other lane then defers to the next tick rather than also
    // squeezing through, so "takes priority" means the loser waits its turn, not that
    // both sneak in together.
    let priorityLaneClaimedCrossing = false;
    for (const laneIndex of laneOrder) {
      const oldLane = entity.lanes[laneIndex];
      const speed = laneSpeedPerTick(entity);
      const dest = laneIndex === 0 ? dest0 : dest1;
      const destKey = dest ? `${dest.entity.id}:${dest.lane}` : null;
      const isPriorityLaneOfCollapse = collapsedOnto !== null && laneIndex !== collapsedOnto;
      const isNonPriorityLaneOfCollapse = collapsedOnto !== null && laneIndex === collapsedOnto;
      const isWinner =
        destKey !== null &&
        winner.get(destKey) === entity &&
        !(isNonPriorityLaneOfCollapse && priorityLaneClaimedCrossing);

      const kept: BeltItem[] = [];
      let ceiling = Infinity;
      // Process front-to-back so each item's ceiling is the item ahead of it.
      for (let i = oldLane.length - 1; i >= 0; i--) {
        const item = oldLane[i];
        const isFront = i === oldLane.length - 1;
        const localCeiling = isFront ? (isWinner ? (reservedRoom.get(destKey!) ?? 1) : 1) : ceiling - BELT_MIN_ITEM_GAP;
        const newPos = Math.min(item.pos + speed, Math.max(item.pos, localCeiling));
        if (newPos > 1 && dest) {
          const overflow = newPos - 1;
          const list = arrivals.get(dest.entity.id) ?? [];
          list.push({ lane: dest.lane, item: item.item, pos: overflow });
          arrivals.set(dest.entity.id, list);
          if (destKey) reservedRoom.set(destKey, 1 + overflow);
          ceiling = newPos;
          if (isFront && isPriorityLaneOfCollapse) priorityLaneClaimedCrossing = true;
        } else if (newPos >= 1 && !dest) {
          // queued at the exit edge, nowhere to go.
          kept.unshift({ item: item.item, pos: 1 });
          ceiling = 1;
        } else {
          kept.unshift({ item: item.item, pos: newPos });
          ceiling = newPos;
        }
      }
      lanes[laneIndex] = kept;
    }
    newLanes.set(entity.id, lanes);
  }

  // Underground tunnels: advance in-transit items and hand off arrivals at the exit.
  for (const entity of holders) {
    if (entity.kind !== "underground-belt" || entity.role !== "entrance") continue;
    const partner = entity.partnerId !== null ? (state.entities.get(entity.partnerId) as UndergroundBeltEntity | undefined) : undefined;
    for (const laneIndex of [0, 1] as const) {
      const speed = laneSpeedPerTick(entity);
      const tunnelLane = entity.tunnel[laneIndex];
      const still: { item: ItemId; remaining: number }[] = [];
      for (const inTransit of tunnelLane) {
        const remaining = inTransit.remaining - speed;
        if (remaining > 0) {
          still.push({ item: inTransit.item, remaining });
          continue;
        }
        if (!partner) {
          still.push({ item: inTransit.item, remaining: 0 }); // no exit — stalls at the mouth.
          continue;
        }
        // Only hand off to the exit's surface lane if there's actually room there — same
        // min-gap rule a regular belt-to-belt crossing already enforces via reservedRoom/
        // ceiling above. Without this, a jammed exit lane never pushed back: the tunnel kept
        // draining into it unconditionally, so a downstream jam just relocated the "infinite
        // buffer" symptom one tile forward instead of fixing it.
        const exitLane = partner.lanes[laneIndex];
        const exitHasRoom = exitLane.length === 0 || exitLane[0].pos >= BELT_MIN_ITEM_GAP;
        if (!exitHasRoom) {
          still.push({ item: inTransit.item, remaining: 0 }); // waits at the tunnel mouth for exit room.
          continue;
        }
        const overshoot = -remaining;
        const list = arrivals.get(partner.id) ?? [];
        list.push({ lane: laneIndex, item: inTransit.item, pos: Math.min(1, overshoot) });
        arrivals.set(partner.id, list);
      }
      tunnelLane.length = 0;
      tunnelLane.push(...still);
    }
  }

  // Entrance front items that overflowed (dest === null, role === entrance) go into the tunnel.
  for (const entity of holders) {
    if (entity.kind !== "underground-belt" || entity.role !== "entrance") continue;
    const maxGap = UNDERGROUND_BELT_MAX_GAP[entity.tier];
    const partner = entity.partnerId !== null ? (state.entities.get(entity.partnerId) as UndergroundBeltEntity | undefined) : undefined;
    // Transit time is scaled to the ACTUAL tile distance to the paired exit, not the
    // tier's max gap — underground travel takes exactly as long as covering the same
    // number of tiles on the surface would, in the real game. An adjacent pair used to
    // take just as long to tunnel through as a pair stretched to the tier's max range,
    // which is what made entry and exit timing look mismatched. Falls back to the max
    // gap only while unpaired, since there's no partner yet to measure a distance to.
    const travelTiles = partner ? Math.abs(partner.pos.x - entity.pos.x) + Math.abs(partner.pos.y - entity.pos.y) : maxGap;
    // A real underground belt's tunnel holds exactly what the same length of ordinary belt
    // would: wiki.factorio.com/Transport_belts/Physics gives 4 items/tile/lane as the belt
    // density ceiling (already BELT_MIN_ITEM_GAP = 1/4 tile elsewhere in this file), and a
    // forum-reported circuit-network item count for a real paired underground belt
    // (forums.factorio.com/122855: 8 items/tile combined lanes x total physical tile length)
    // confirms capacity scales with actual distance, not a fixed per-tunnel constant. Without
    // this cap the tunnel's entry check only ever compared a new item against the single most
    // recently entered one, so once an item got permanently stuck (no partner, or a jammed
    // exit) it stopped counting against room at all and the tunnel absorbed items forever.
    const maxTunnelOccupancy = Math.max(1, Math.floor(travelTiles / BELT_MIN_ITEM_GAP));
    for (const laneIndex of [0, 1] as const) {
      const oldLane = entity.lanes[laneIndex];
      const front = frontOf(oldLane);
      if (!front) continue;
      const speed = laneSpeedPerTick(entity);
      const tunnelLane = entity.tunnel[laneIndex];
      const lastRemaining = tunnelLane.length > 0 ? tunnelLane[tunnelLane.length - 1].remaining : travelTiles;
      const room = travelTiles - lastRemaining;
      const canEnter = tunnelLane.length < maxTunnelOccupancy && (tunnelLane.length === 0 || room >= BELT_MIN_ITEM_GAP);
      const newPos = Math.min(front.pos + speed, canEnter ? Infinity : 1);
      const kept = newLanes.get(entity.id)!;
      if (newPos >= 1 && canEnter) {
        // Remove the version already computed as "queued at edge" and push into the tunnel instead.
        kept[laneIndex] = kept[laneIndex].filter((i) => i !== front && !(i.item === front.item && i.pos === 1));
        tunnelLane.push({ item: front.item, remaining: travelTiles - (newPos - 1) });
      }
    }
  }

  for (const entity of holders) {
    const lanes = newLanes.get(entity.id)!;
    const pending = arrivals.get(entity.id);
    if (pending) {
      for (const p of pending) {
        const pos = Math.max(0, Math.min(1, p.pos));
        lanes[p.lane].push({ item: p.item, pos });
      }
    }
    lanes[0].sort((a, b) => a.pos - b.pos);
    lanes[1].sort((a, b) => a.pos - b.pos);
    entity.lanes = lanes;
  }
}

/** True if this lane-holder's front item on `lane` is stalled (compressed belt), used by
 * inserters to decide whether the near/far pickup-speed bonus applies. */
export function isLaneStalled(entity: LaneHolder, lane: 0 | 1): boolean {
  const l = entity.lanes[lane];
  if (l.length === 0) return false;
  const front = frontOf(l);
  return !!front && front.pos >= 1 - 1e-6;
}

export function peekLaneFront(entity: LaneHolder, lane: 0 | 1): BeltItem | undefined {
  return frontOf(entity.lanes[lane]);
}

export function takeLaneFront(entity: LaneHolder, lane: 0 | 1): BeltItem | undefined {
  return entity.lanes[lane].pop();
}

/** Insert a single item at the back of a lane (used by inserters and sources dropping onto a
 * belt). A belt slot holds exactly one item — see the module header — so this only ever
 * places one at a time; a caller with more than one item to place calls this once per item. */
export function insertIntoLaneBack(entity: LaneHolder, lane: 0 | 1, item: ItemId): boolean {
  const l = entity.lanes[lane];
  if (l.length > 0 && l[0].pos < BELT_MIN_ITEM_GAP) return false;
  l.unshift({ item, pos: 0 });
  return true;
}

/** Resolve underground belt entrance/exit pairing along the direction they face. */
export function resolveUndergroundPartners(state: SimState): void {
  if (!state.beltDirty) return;
  state.beltDirty = false;
  const undergrounds = [...state.entities.values()].filter(
    (e): e is UndergroundBeltEntity => e.kind === "underground-belt",
  );
  for (const u of undergrounds) u.partnerId = null;
  for (const entrance of undergrounds) {
    if (entrance.role !== "entrance") continue;
    const maxGap = UNDERGROUND_BELT_MAX_GAP[entrance.tier];
    const step = tileAhead(entrance.pos, entrance.dir); // one tile ahead == the direction delta, applied below per distance
    const delta: Vec2 = { x: step.x - entrance.pos.x, y: step.y - entrance.pos.y };
    for (let dist = 1; dist <= maxGap; dist++) {
      const target: Vec2 = { x: entrance.pos.x + delta.x * dist, y: entrance.pos.y + delta.y * dist };
      const occupant = entityAt(state, target);
      if (!occupant) continue;
      if (
        occupant.kind === "underground-belt" &&
        occupant.role === "exit" &&
        occupant.tier === entrance.tier &&
        occupant.dir === entrance.dir
      ) {
        entrance.partnerId = occupant.id;
        occupant.partnerId = entrance.id;
        break;
      }
      // Only a same-tier underground belt blocks the search (wiki.factorio.com/
      // Underground_belt): a plain surface belt crossing over the tunnel never
      // interferes, and different-tier undergrounds can cross ("weave") the same
      // line without connecting or obstructing each other.
      if (occupant.kind === "underground-belt" && occupant.tier === entrance.tier) break;
    }
  }
}

/** Walks from `origin` along `walkDir`, up to the tier's max gap, looking for an unpaired
 * underground belt facing `matchDir` with role `matchRole`. Stops at the first same-tier
 * underground belt encountered either way — a non-matching one obstructs the tunnel just
 * like it does in `resolveUndergroundPartners`, so the search can't skip past it. */
function hasUnpairedPartnerAlong(
  state: SimState,
  origin: Vec2,
  walkDir: Direction,
  tier: BeltTier,
  matchDir: Direction,
  matchRole: "entrance" | "exit",
): boolean {
  const maxGap = UNDERGROUND_BELT_MAX_GAP[tier];
  const delta = DIR_DELTA[walkDir];
  for (let dist = 1; dist <= maxGap; dist++) {
    const target: Vec2 = { x: origin.x + delta.x * dist, y: origin.y + delta.y * dist };
    const occupant = entityAt(state, target);
    if (!occupant) continue;
    if (occupant.kind !== "underground-belt" || occupant.tier !== tier) continue;
    if (occupant.dir === matchDir && occupant.role === matchRole && occupant.partnerId === null) return true;
    return false; // a same-tier underground belt that isn't the match obstructs the tunnel.
  }
  return false;
}

/** Auto-detects whether a newly placed underground belt should be an entrance or exit,
 * mirroring the real game's placement snapping: placing one near an unpaired, same-tier,
 * same-facing underground belt within tunnel range automatically completes the pair rather
 * than requiring the placer to also manually pick a role. Falls back to `fallback` (the
 * editor's manually-toggled role) when no such candidate exists, e.g. the first end of a
 * fresh pair. */
export function detectUndergroundRole(
  state: SimState,
  pos: Vec2,
  dir: Direction,
  tier: BeltTier,
  fallback: "entrance" | "exit",
): "entrance" | "exit" {
  // An unpaired entrance behind us, facing the same way we do, would treat us as its exit.
  if (hasUnpairedPartnerAlong(state, pos, oppositeDir(dir), tier, dir, "entrance")) return "exit";
  // An unpaired exit ahead of us, facing the same way we do, would treat us as its entrance.
  if (hasUnpairedPartnerAlong(state, pos, dir, tier, dir, "exit")) return "entrance";
  return fallback;
}

export function feedTileAhead(pos: Vec2, dir: 0 | 1 | 2 | 3): Vec2 {
  return tileAhead(pos, dir);
}

export function feedTileBehind(pos: Vec2, dir: 0 | 1 | 2 | 3): Vec2 {
  return tileBehind(pos, dir);
}
