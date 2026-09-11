// Power pole network resolution and supply-area coverage.
//
// Poles wire together (union-find) when the distance between them is within
// the smaller of the two poles' wire reach — matching the real game's rule
// that a connection needs both ends in range. There are no generator
// entities in this simulator (see the task brief: infinite sources stand in
// for production); instead, per "different power poles (connect to edge of
// map)", a pole network is powered if ANY pole in it touches the edge of the
// playable grid, treated as a connection to power from outside the map.
// This is this simulator's own stand-in for a generator, not a cited game
// mechanic.

import { POLE_SPEC } from "../constants";
import { footprintTiles, type SimState } from "../grid";
import type { Entity, PoleEntity, Vec2 } from "../types";
import { DisjointSet } from "../grid";

function poleCenter(pole: PoleEntity): Vec2 {
  const size = POLE_SPEC[pole.tier].footprint;
  return { x: pole.pos.x + (size - 1) / 2, y: pole.pos.y + (size - 1) / 2 };
}

function poleDistance(a: PoleEntity, b: PoleEntity): number {
  const ca = poleCenter(a);
  const cb = poleCenter(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

function withinSupply(pole: PoleEntity, pos: Vec2): boolean {
  const center = poleCenter(pole);
  const half = POLE_SPEC[pole.tier].supplyArea / 2;
  return Math.abs(pos.x - center.x) <= half && Math.abs(pos.y - center.y) <= half;
}

function touchesEdge(state: SimState, pole: PoleEntity): boolean {
  return footprintTiles(pole).some(
    (tile) => tile.x === 0 || tile.y === 0 || tile.x === state.width - 1 || tile.y === state.height - 1,
  );
}

export function resolvePowerNetwork(state: SimState): void {
  if (!state.powerDirty) return;

  const poles: PoleEntity[] = [];
  for (const e of state.entities.values()) if (e.kind === "pole") poles.push(e);

  const dsu = new DisjointSet();
  for (const p of poles) dsu.find(p.id);
  for (let i = 0; i < poles.length; i++) {
    for (let j = i + 1; j < poles.length; j++) {
      const a = poles[i];
      const b = poles[j];
      if (poleDistance(a, b) <= Math.min(POLE_SPEC[a.tier].wireReach, POLE_SPEC[b.tier].wireReach)) {
        dsu.union(a.id, b.id);
      }
    }
  }

  const rootToNetwork = new Map<number, number>();
  const powered = new Set<number>();
  let nextNetworkId = 0;
  for (const p of poles) {
    const root = dsu.find(p.id);
    let netId = rootToNetwork.get(root);
    if (netId === undefined) {
      netId = nextNetworkId++;
      rootToNetwork.set(root, netId);
    }
    p.networkId = netId;
    if (touchesEdge(state, p)) powered.add(netId);
  }

  state.poweredNetworks = powered;
  state.powerDirty = false;
}

function isPositionPowered(state: SimState, pos: Vec2): boolean {
  for (const e of state.entities.values()) {
    if (e.kind !== "pole" || e.networkId === null) continue;
    if (!state.poweredNetworks.has(e.networkId)) continue;
    if (withinSupply(e, pos)) return true;
  }
  return false;
}

/** True if any tile of `entity`'s footprint falls in a powered pole's supply area. */
export function isEntityPowered(state: SimState, entity: Entity): boolean {
  return footprintTiles(entity).some((tile) => isPositionPowered(state, tile));
}

export function tickPower(state: SimState): void {
  resolvePowerNetwork(state);
  for (const e of state.entities.values()) {
    if (e.kind === "assembler") e.poweredThisTick = isEntityPowered(state, e);
  }
}

/** True if `ghostPole` (typically not yet placed — see editor.ts's buildGhostEntity) would
 * wire into at least one already-placed pole, using the exact same reach rule
 * resolvePowerNetwork uses internally. Drives the placement preview's blue/black outline. */
export function wouldPoleConnect(state: SimState, ghostPole: PoleEntity): boolean {
  for (const e of state.entities.values()) {
    if (e.kind !== "pole") continue;
    if (poleDistance(ghostPole, e) <= Math.min(POLE_SPEC[ghostPole.tier].wireReach, POLE_SPEC[e.tier].wireReach)) {
      return true;
    }
  }
  return false;
}

/** Every pair of currently-placed poles that are wired together, for the power overlay to
 * draw a line between. Same pairwise reach rule as resolvePowerNetwork's own union-find pass. */
export function connectedPolePairs(state: SimState): [PoleEntity, PoleEntity][] {
  const poles: PoleEntity[] = [];
  for (const e of state.entities.values()) if (e.kind === "pole") poles.push(e);

  const pairs: [PoleEntity, PoleEntity][] = [];
  for (let i = 0; i < poles.length; i++) {
    for (let j = i + 1; j < poles.length; j++) {
      const a = poles[i];
      const b = poles[j];
      if (poleDistance(a, b) <= Math.min(POLE_SPEC[a.tier].wireReach, POLE_SPEC[b.tier].wireReach)) {
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}
