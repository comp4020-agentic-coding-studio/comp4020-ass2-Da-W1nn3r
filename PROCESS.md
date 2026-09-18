# Process overview

## What "good" meant here

A good course for this brief is one where the fixed content model — four
assessments, twelve weeks, one real deck — reads as a real syllabus rather
than filled-in placeholders: every date, weight, and cross-reference
load-bearing, not decorative. The result is Slop University's "Factorio:
Engineering Addiction" (`SLOP2130`), a systems-engineering course taught
through Factorio, twelve weeks from hand-mined ore to a megabase.

## From outline to content

I started from a fully-worked 12-week syllabus (`Course_Outline.md`) rather
than inventing one mid-session, drafted all twelve weeks in a scratch
`drafts/` folder, and moved content into `src/content/` only once confirmed
— content decisions made once, not iterated in place against the schema.
Course identity landed first
([`d68c41a`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/d68c41a)),
then people
([`b83b29b`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/b83b29b)),
assessments
([`b135e39`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/b135e39)),
all twelve weeks
([`ccfd87a`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/ccfd87a)),
and the deck plus policies
([`8b8c76f`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/8b8c76f)).
Hero and card art stayed placeholder boxes on explicit instruction, real
screenshots sourced separately
([`1be7b5d`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/1be7b5d)).
`spec/course-content.test.ts` encodes the four promises the schema doesn't
check on its own — weights summing to 100, one lecture and tutorial per
week, a real linked deck, non-empty tutorial frontmatter
([`83d26e5`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/83d26e5)).

## Catching real problems by running things

Building surfaced two Windows-only `spawn npx ENOENT` failures in two
different dependencies' hooks, diagnosed and documented in `CLAUDE.md`
rather than worked around permanently, since `astro.config.ts` is fixed.
Unblocking one temporarily surfaced real axe violations: three `.mdx` index
pages had no `layout:` frontmatter and skipped the theme's default layout,
fixed by pointing each at `PageLayout.astro`
([`f7bed6f`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/f7bed6f)).
Loading the Week 1 deck in a browser, not just reading the MDX, showed three
slides clipping content off-screen
([`3777873`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/3777873)),
fixed with real Factorio Wiki screenshots replacing the placeholders
([`56be479`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/56be479)).
The same clipping pattern turned up across nine more decks once ten were
deepened against wiki sources, caught by a permanent headless-Chrome
overflow checker (`scripts/check-deck-overflow.ts`, `pnpm check:overflow`)
rather than eyeballing each one
([`7cc3391`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/7cc3391)).

## The simulator, and what stayed out of scope

Beyond the fixed model, `/simulator/` is a canvas factory simulator (belts,
inserters, assemblers, chests) the practicals point students at, with every
numeric constant cited against the wiki rather than recalled
([`c174a64`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/c174a64)),
later extended with a void-chest entity for checking splitter/balancer
output balance
([`0ff32a1`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/0ff32a1)).
I deliberately excluded train and circuit-network simulation and a
save/load layer — the practicals that need those still run in-game; the
simulator's job is a quick layout check, not replacing Factorio.

## Closing gaps

A later pass replaced the remaining home-page placeholder with a real
screenshot, corrected the course code to match the schema's `level`
cross-check, wired the simulator into the Week 3, 4, and 9 practicals it was
built for but hadn't been linked from, and linked the Week 8 base download
directly
([`7c37a6f`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/7c37a6f)).
Policies and Help merged into a single Admin page, since a save-submission
rule and a save-folder location are the same kind of question from two
directions, with real storefront and mod-portal links sourced rather than
typed from memory
([`bb8dcae`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/bb8dcae)).
