// Chest inventory: slot-based capacity, matching the real game's rule that each of a
// chest's fixed number of slots holds up to one stack of a single item type (see
// constants.ts's CHEST_SLOTS/ITEM_STACK_SIZE for the cited sourcing). Chests have no
// per-tick behaviour of their own — they're only touched by inserters (tryPickup/tryDrop
// in inserter.ts), the same passive-storage role assembler input/output buffers already
// play elsewhere in this codebase.

import { CHEST_SLOTS, ITEM_STACK_SIZE } from "../constants";
import type { ChestEntity, ItemId } from "../types";

/** Slots currently occupied, each item type rounded up to a whole number of slots. */
export function chestSlotsUsed(chest: ChestEntity): number {
  let slots = 0;
  for (const [item, count] of Object.entries(chest.inventory)) {
    if (count <= 0) continue;
    const stackSize = ITEM_STACK_SIZE[item] ?? 1;
    slots += Math.ceil(count / stackSize);
  }
  return slots;
}

/** Inserts up to `count` of `item`, limited by remaining slots (a new item type needs at
 * least one free slot; an existing type can still top up its own slots). Returns how many
 * actually fit — partial inserts are allowed, matching an inserter's held count shrinking
 * by however much the destination actually accepted. */
export function chestInsert(chest: ChestEntity, item: ItemId, count: number): number {
  const stackSize = ITEM_STACK_SIZE[item] ?? 1;
  const have = chest.inventory[item] ?? 0;
  const usedByOthers = chestSlotsUsed(chest) - Math.ceil(have / stackSize);
  const freeSlots = CHEST_SLOTS[chest.tier] - usedByOthers;
  const capForItem = Math.max(0, freeSlots * stackSize);
  const newTotal = Math.min(have + count, capForItem);
  const accepted = newTotal - have;
  if (accepted <= 0) return 0;
  chest.inventory[item] = newTotal;
  return accepted;
}

/** How many more of `item` the chest currently has room for (0 if full for that item
 * type, or if there's no free slot left for a type it doesn't already hold). Same
 * capacity math as chestInsert, without mutating — used by inserter.ts's tryPickup to
 * avoid grabbing an item that would just sit stuck in the inserter's hand because the
 * chest destination is already full for it. */
export function chestRoomFor(chest: ChestEntity, item: ItemId): number {
  const stackSize = ITEM_STACK_SIZE[item] ?? 1;
  const have = chest.inventory[item] ?? 0;
  const usedByOthers = chestSlotsUsed(chest) - Math.ceil(have / stackSize);
  const freeSlots = CHEST_SLOTS[chest.tier] - usedByOthers;
  const capForItem = Math.max(0, freeSlots * stackSize);
  return Math.max(0, capForItem - have);
}

/** Removes up to `maxCount` of `item`, deleting the key once it reaches 0. Returns how
 * many were actually removed (0 if the chest doesn't hold any). */
export function chestTake(chest: ChestEntity, item: ItemId, maxCount: number): number {
  const have = chest.inventory[item] ?? 0;
  const taken = Math.min(have, maxCount);
  if (taken <= 0) return 0;
  const remaining = have - taken;
  if (remaining <= 0) delete chest.inventory[item];
  else chest.inventory[item] = remaining;
  return taken;
}
