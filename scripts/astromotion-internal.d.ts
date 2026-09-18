// astromotion exports its package root as typed (see its `exports["."]` ->
// `index.ts`), but the `./src/*` subpath used by check-deck-overflow.ts to
// reach its check/chrome internals resolves to plain `.mjs` with no
// declarations. These ambient types cover only what that script imports.
declare module "astromotion/src/chrome.mjs" {
  export function findChrome(): string | undefined;
  export function puppeteerCacheChrome(): string | undefined;
  export function chromeArgs(): string[];
}

declare module "astromotion/src/deck-check.mjs" {
  export const TEXT_SELECTOR: string;
  export interface DeckCheckViolation {
    rule: "overflow" | "clipped";
    detail: string;
  }
  export interface DeckCheckMeasurement {
    error?: string;
    heading?: string;
    violations?: DeckCheckViolation[];
  }
  export function measureSlide(textSelector: string, tolerance: number): DeckCheckMeasurement;
}
