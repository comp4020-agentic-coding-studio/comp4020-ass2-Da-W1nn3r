# Working rules for this repo

The platform is fixed (see `README.md`): the Slop identity, the four content
collections and their keys, `astro.config.ts`, and the generated API stay as
they arrived. Everything else — course identity, all `src/content/` entries,
`src/pages/`, `src/decks/`, the spec suite, and this file — is the deliverable.

## Fixed contract — do not drift from these without updating `spec/`

- Course code keeps the pre-assigned digits `130` (`SLOP4130`).
- Assessment `weight` values sum to exactly 100.
- All 12 teaching weeks stay populated with exactly one `sessions` node and
  one `lectures` node each, every date inside `startDate`/`endDate`.
- At least one lecture keeps a real slide deck under `src/decks/` linked via
  its `slides` field.
- Every `sessions` node keeps non-empty `practical` and `goal` frontmatter.

`spec/course-content.test.ts` enforces the first four of these against
`dist/api/index.json`; `spec/data-integrity.test.ts` enforces the date range.
If a change would break one of these promises on purpose, update the spec in
the same change, not after.

## Images: placeholder-first

`hero-home.avif` and `card.png` are deliberately simple placeholder boxes
(flat background, dashed border, descriptive label) with alt text describing
what real image belongs there. This is intentional, not a stand-in for
unfinished work — real in-game screenshots get sourced and dropped in later.
Don't generate original "themed" artwork to fill the gap; keep the placeholder
obvious so it's clear a real screenshot is still owed.

Slide-deck images under `src/decks/assets/` are the exception: they're real
screenshots pulled from the [Factorio Wiki](https://wiki.factorio.com/),
licensed CC BY-NC-SA 3.0, used here for a non-commercial educational site.
Give each one real, descriptive alt text (not "placeholder — ... will go
here") and a visible source caption under the image in the deck markdown.

## Verification

- Run `pnpm check` after any content change (typecheck, build, spec suite).
- Run `pnpm check:evidence` before treating any milestone as final.
- **Known local limitation on Windows**: `astro-theme-university`'s
  `astro:build:done` hook invokes `npx` via `child_process.execFile` without
  `shell: true`. On Windows this fails with `spawn npx ENOENT` even though
  `npx.cmd` resolves fine from a shell — Node doesn't apply `PATHEXT`
  resolution to `execFile`/`spawn` targets. This hook runs before the
  `course-graph` integration's own `astro:build:done` hook, so a crash here
  also blocks `dist/api/index.json` from being generated locally, and blocks
  the axe accessibility and link checks from running.
  `.github/workflows/checks.yml` runs `pnpm check` on `ubuntu-latest`, which
  doesn't have this extension-resolution issue — treat that CI run as the
  authoritative `pnpm check` result, not a local Windows build. (If you need
  to verify locally on Windows anyway, temporarily passing `search: false` to
  `universityTheme()` unblocks the hook enough to run axe/link checks and
  generate the API — revert it before committing; `astro.config.ts` doesn't
  ship with that flag.)

## Game accuracy: research before writing

Any course content that describes a specific Factorio technique or topic
(a mechanic, a ratio, a named strategy — "burner chains," boiler/steam
ratios, belt balancers, and so on) must be checked against a real source
(the [Factorio wiki](https://wiki.factorio.com/), the official forums, or
current in-game behaviour) before it's written, not recalled from memory.
This has already produced one real error: an earlier version of the Week 1
deck described "burner chains" as running through burner inserters, when
the actual mechanic is a mining drill depositing its output directly into
whatever's immediately in front of it, including another drill's fuel
tank — the inserter isn't there at all. Getting this wrong doesn't just
read badly, it teaches an incorrect mental model to whoever reads the
course. When adding or revising a slide, a lecture outline, or a tutorial
practical, search for and cite the mechanic first, then write.

## Tone

Dry and technical throughout — course copy, policies, commit messages,
`PROCESS.md`. Not jokey or meme-y, even though the subject is a video game.

## `PROCESS.md`

Cite only real commit hashes/ranges, taken from `git log` at the time of
writing — never invented or approximate ones.
