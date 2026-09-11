// Assembling machine tick simulation: consume buffered ingredients at the
// start of a craft, progress at craftingSpeed / craftTimeSeconds per tick,
// then produce into the output buffer once the output has room.
// `poweredThisTick` is set by power.ts before this runs each tick; an
// unpowered assembler makes no progress, matching a real brownout stalling
// production rather than slowing it to a fraction (this simulator doesn't
// model partial/degraded power).

import { ASSEMBLER_BUFFER_CAP_MULTIPLIER, ASSEMBLER_SPEC, RECIPES, TICKS_PER_SECOND, type Recipe } from "../constants";
import { recordStat, type SimState } from "../grid";

function canAffordInputs(entity: { inputBuffer: Record<string, number> }, recipe: Recipe): boolean {
  return recipe.ingredients.every((ing) => (entity.inputBuffer[ing.item] ?? 0) >= ing.amount);
}

function consumeInputs(entity: { inputBuffer: Record<string, number> }, recipe: Recipe): void {
  for (const ing of recipe.ingredients) entity.inputBuffer[ing.item] -= ing.amount;
}

/** How much of `item` a recipe's input buffer will hold before it's "full" for that
 * ingredient — see ASSEMBLER_BUFFER_CAP_MULTIPLIER's comment. 0 if `item` isn't one of
 * this recipe's ingredients. Exported for inserter.ts: both to cap what a drop actually
 * places (tryDrop) and to decide an item is no longer worth picking up for this
 * destination at all (destinationRoomFor's "still needed" check). */
export function ingredientInputCap(recipe: Recipe, item: string): number {
  const ing = recipe.ingredients.find((i) => i.item === item);
  return ing ? ing.amount * ASSEMBLER_BUFFER_CAP_MULTIPLIER : 0;
}

function hasOutputRoom(entity: { outputBuffer: Record<string, number> }, recipe: Recipe): boolean {
  return recipe.results.every(
    (r) => (entity.outputBuffer[r.item] ?? 0) + r.amount <= r.amount * ASSEMBLER_BUFFER_CAP_MULTIPLIER,
  );
}

function produceOutputs(entity: { outputBuffer: Record<string, number> }, recipe: Recipe): void {
  for (const r of recipe.results) entity.outputBuffer[r.item] = (entity.outputBuffer[r.item] ?? 0) + r.amount;
}

export function tickAssemblers(state: SimState): void {
  for (const entity of state.entities.values()) {
    if (entity.kind !== "assembler" || !entity.recipeId) continue;
    const recipe = RECIPES.find((r) => r.id === entity.recipeId);
    if (!recipe) continue;
    if (!entity.poweredThisTick) {
      recordStat(state, entity.id, "starved");
      continue;
    }

    if (entity.progress === 0) {
      if (!canAffordInputs(entity, recipe)) {
        recordStat(state, entity.id, "starved"); // waiting on ingredients
        continue;
      }
      consumeInputs(entity, recipe);
    }

    const speed = ASSEMBLER_SPEC[entity.tier].craftingSpeed;
    const newProgress = entity.progress + speed / (recipe.craftTimeSeconds * TICKS_PER_SECOND);

    if (newProgress < 1) {
      entity.progress = newProgress;
      recordStat(state, entity.id, "active");
      continue;
    }
    if (!hasOutputRoom(entity, recipe)) {
      entity.progress = 1; // blocked: finished crafting, nowhere to put the result yet
      recordStat(state, entity.id, "blocked");
      continue;
    }
    produceOutputs(entity, recipe);
    entity.progress = 0;
    recordStat(state, entity.id, "active");
  }
}
