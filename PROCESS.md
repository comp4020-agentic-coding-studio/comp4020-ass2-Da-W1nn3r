# Process overview

## What I built

Slop University's course site for "Factorio: Engineering Addiction"
(`SLOP4130`) — a systems-engineering course taught entirely through the game
Factorio, twelve dated weeks from hand-mined ore to a megabase, mapped onto
the platform's fixed content model: a lecture and a tutorial per week, four
assessments weighted to sum to 100, one real slide deck, and a policies page
written for the course rather than left as starter text.

## How I got here

I started from a fully-worked 12-week syllabus (`Course_Outline.md`) rather
than inventing one during the session, which meant the design work was
mostly mapping, not authoring from nothing: which outline bullets become the
lecture's `## Outline`, which become the tutorial's `practical`/`goal`
frontmatter, and where `related:` should tie a week forward to an assessment.
Before touching any real content collection file, I drafted all twelve weeks
as plain markdown in a scratch `drafts/` folder for review — confirmed
("Looks good start building") before any of it became a `src/content/`
file — so the content decisions were made once, not iterated in place against
the schema.

Course identity and branding landed first
([`d68c41a`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/d68c41a)),
then the fixed collections one at a time: people
([`b83b29b`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/b83b29b)),
the four assessments
([`b135e39`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/b135e39)),
all twelve weeks of lectures and tutorials
([`ccfd87a`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/ccfd87a)),
and the deck plus policies
([`8b8c76f`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/8b8c76f)).
Hero and card art became placeholder boxes rather than original artwork, on
explicit instruction — real in-game screenshots are being sourced separately
([`1be7b5d`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/1be7b5d)).

Knowing the result was right meant actually running the build, which
surfaced two real problems rather than confirming everything was fine.
First, `astro-theme-university`'s `astro:build:done` hook calls `npx` via
`execFile` without `shell: true`, which fails with `spawn npx ENOENT` on
Windows specifically (confirmed with a minimal repro, and confirmed CI runs
on `ubuntu-latest` where this doesn't occur) — documented in `CLAUDE.md`
rather than worked around permanently, since `astro.config.ts` is fixed.
Second, once I temporarily unblocked that hook locally to actually see the
accessibility check run, axe reported real violations — missing `<title>`,
missing `lang`, no landmark region — on the `assessments/`, `lectures/`, and
`people/` index pages. These `.mdx` pages had no `layout:` frontmatter field,
so the theme's default-layout remark plugin (which only runs through
Astro's `.md` pipeline) never wrapped them, unlike `sessions/index.astro`,
which imported the layout explicitly. Fixed by pointing each at
`src/layouts/PageLayout.astro`
([`f7bed6f`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/f7bed6f)),
and rebuilt clean: zero accessibility violations, no broken links.

Last, I wrote `spec/course-content.test.ts` against the actual generated
`dist/api/index.json` shape, to hold the four promises the schema doesn't
check on its own — weights summing to 100, one lecture and one tutorial per
week, a real linked deck, and non-empty `practical`/`goal` on every tutorial
([`83d26e5`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/83d26e5)).
