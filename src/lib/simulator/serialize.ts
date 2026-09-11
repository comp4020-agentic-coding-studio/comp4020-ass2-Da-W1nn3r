// Autosave to localStorage so a page reload doesn't lose the layout. No
// URL-sharing feature — out of scope per the plan.

import { createState, footprintTiles, tileKey, type SimState } from "./grid";
import type { Entity } from "./types";

const STORAGE_KEY = "factorio-simulator-autosave";

interface SavedState {
  width: number;
  height: number;
  nextId: number;
  tick: number;
  entities: Entity[];
}

export function serializeState(state: SimState): string {
  const saved: SavedState = {
    width: state.width,
    height: state.height,
    nextId: state.nextId,
    tick: state.tick,
    entities: [...state.entities.values()],
  };
  return JSON.stringify(saved);
}

export function deserializeState(json: string): SimState {
  const saved = JSON.parse(json) as SavedState;
  const state = createState(saved.width, saved.height);
  state.nextId = saved.nextId;
  state.tick = saved.tick;
  for (const entity of saved.entities) {
    state.entities.set(entity.id, entity);
    for (const tile of footprintTiles(entity)) state.occupancy.set(tileKey(tile), entity.id);
  }
  return state;
}

export function saveToLocalStorage(state: SimState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeState(state));
  } catch {
    // localStorage unavailable (private browsing, quota) — autosave is best-effort.
  }
}

export function loadFromLocalStorage(): SimState | null {
  try {
    const json = window.localStorage.getItem(STORAGE_KEY);
    return json ? deserializeState(json) : null;
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
