# Process overview

## What I built

Slop University's course site for "Factorio: Engineering Addiction"
(`SLOP2130`) — a systems-engineering course taught entirely through the game
Factorio, twelve dated weeks from hand-mined ore to a megabase, mapped onto
the platform's fixed content model: a lecture and a tutorial per week, four
assessments weighted to sum to 100, one real slide deck, and a policies page
written for the course rather than left as starter text.

## How I got here

I started from a fully-worked 12-week syllabus (`Course_Outline.md`) rather
than inventing one during the session, so the design work was mapping, not
authoring from nothing: which outline bullets become the lecture's
`## Outline`, which become the tutorial's `practical`/`goal` frontmatter, and
where `related:` ties a week forward to an assessment. I drafted all twelve
weeks as plain markdown in a scratch `drafts/` folder first — confirmed
("Looks good start building") before any became a `src/content/` file — so
content decisions were made once, not iterated in place against the schema.

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

Actually running the build, rather than trusting it would work, surfaced two
real problems. First, `astro-theme-university`'s `astro:build:done` hook calls `npx` via
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

## Week 1 deck: catching a content-overflow bug

Fixing the burner-chain and big-rocks mechanics
([`3777873`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/3777873))
still left three Week 1 slides — burner chains, direct burner-to-furnace,
boiler/steam power — each packing a paragraph, three bullets, and an image
onto one slide. Loading the deck in a browser, rather than trusting the MDX,
showed why: the last bullet cut off mid-sentence at the slide edge, and
scrolling down revealed the placeholder image pushed out of view underneath.
Both captured by checking out `3777873` for this "before":

![The "Burner chains" slide at commit 3777873, viewport height clipping the
third bullet point mid-sentence after "don't bolt a burner inserter onto a
drill to 'skim' the
excess"](reflections/screenshots/slide-content-cutoff-3777873.png)

![The same slide scrolled down, showing the full bullet list followed by a
dashed-border placeholder box labelled "PLACEHOLDER — burner chain
screenshot" pushed below the
fold](reflections/screenshots/slide-content-vertical-3777873.png)

Fixed by splitting each overloaded slide into a text slide and a separate
image slide, so the image no longer competes with body text for space, and
adding a fourth slide pair for hand-fed assembling machines, which the deck
hadn't covered before. The three placeholder PNGs were replaced with real
Factorio Wiki screenshots (CC BY-NC-SA 3.0), each with descriptive alt text
and a source caption
([`56be479`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/56be479)).

## The factory simulator

Beyond the fixed content model, the practicals needed something to point
students at while they build: a canvas-based factory simulator at
`/simulator/`, modelling belts, underground belts, splitters, inserters,
assembling machines, power poles, and chests on a per-tick loop, with an
editor UI (palette, inspector, bottleneck analysis) built up over several
sessions and landed in one commit
([`c174a64`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/c174a64)).
Every numeric constant — belt throughput, inserter cycle times, chest slot
counts, stack sizes — is cited against the Factorio wiki or forums rather
than recalled from memory, the same standard `CLAUDE.md` holds course
content to.

Manual testing against the running simulator surfaced many real bugs over
development — far more than the handful worth naming here — spanning
tick-engine interactions between entities and the editor's add/edit overlay
UI. Among them, fixed in the same commit: the inspector wasn't rendering belt
or inserter contents at all; an inserter feeding a multi-ingredient assembler
would fixate on whichever ingredient was already at its input-buffer cap
instead of switching to one the recipe still needed (a mixed-belt-pickup
case the original implementation hadn't accounted for); and an idle inserter
could freeze mid-swing still holding an item instead of settling
empty-handed, breaking the "belts and inserters show their contents" model
the inspector supports. Follow-up feedback removed the manual
underground-belt entrance/exit toggle (placement-proximity auto-detection
already covers the real workflow, making the override dead weight), added a
"Clear items" action to empty all in-flight/stored items without touching
the layout or its configuration, and fixed a CSS cascade bug where the
inspector panel covered roughly half the canvas on landscape-oriented narrow
viewports.

## Closing gaps: real hero image, course code, and a Help page

A last pass replaced the remaining placeholder and wired up content that had
been sitting unlinked. The home page's `hero-home.avif` placeholder box
became a real screenshot (a rocket silo mid-launch), and the course code
changed from `SLOP4130` to `SLOP2130`, which also meant updating the
`level` field the schema's `superRefine` cross-checks against the code's
digits. The Week 8 diagnostic tutorial now links its supplied base
(`Base_Analysis.zip`) as a direct download rather than assuming students
already had it. A new Help page collects the practical logistics that don't
belong in course content proper — where to buy Factorio, and where each OS
puts Factorio's save folder — and took over the simulator link that used to
sit in the main nav; the simulator itself picked up direct links from the
Week 3, 4, and 9 tutorials, at the point in each practical where checking a
layout in the simulator is cheaper than building it and finding out in-game
([`7c37a6f`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/7c37a6f)).

## Policies and Help, folded into one Admin page

Having both a Policies page and a Help page split closely related content
across two nav entries and two URLs for no real reason — a student looking
for the save-submission rule and a student looking for where their save
file actually lives on disk are asking about the same thing from two
directions. Merged both into a single page at `/admin/`, replacing both nav
links with one. Added real hyperlinks to Factorio's GOG and Steam store
pages, sourced by search rather than typed from memory, since a wrong game
storefront link is exactly the kind of thing that looks fine and isn't. Also
added an approved-mods list — seven visualisation/convenience mods that
don't touch recipes or ratios, so a save built with them stays comparable to
one without — linking each mod's page on the Factorio mod portal with its
real name and description, fetched from the page rather than guessed from
the URL slug
([`bb8dcae`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/bb8dcae)).

## Deepening the decks, then catching what didn't fit

The ten decks with room to grow (Weeks 1, 3–6, 8–12) were expanded
against the Factorio Wiki's own pages rather than recalled from memory, per
`CLAUDE.md`'s research-before-writing rule — real formulas (evolution's
squashing curve, mining and belt throughput, the fluid pressure-equalisation
example), real hardware limits (roboport charging slots, rail-station
inserter counts, pole connection limits), and new slides for subtopics the
outline called for but the deck never covered (logistic chest types, circuit
wildcards, wire-colour independence). Every new image is a real Factorio
Wiki screenshot with descriptive alt text and a source caption, matching the
existing convention, not a generated placeholder.

Deepening ten decks at once, onto a canvas that Reveal.js fixes at 1280×720
with no autofit (astromotion's own design — content taller than that clips
or runs off the edge silently), was always going to overflow some slides.
Rather than eyeball each one, I built a real check: a script driving headless
Chrome through every slide of every deck, reusing astromotion's own
`measureSlide`/`TEXT_SELECTOR` internals (the same measurement its
`astromotion-check` bin uses) so a "fits" verdict means the same thing
here as it does upstream. That bin's own CLI turned out to be unusable
on Windows — its wrapper spawns its own `astro dev` server via
`spawn("npx", ..., { shell: true })`, which still throws an unhandled
`spawn npx ENOENT` here, a separate bug from the already-documented
`astro-theme-university` build-hook one — so the script talks to a dev
server already running instead of starting its own.

That check found 45 real overflow/clip violations across nine decks — most
of the newly expanded ones (Weeks 3 and 11 fit as written), plus Week 2's
"Bot base" slide, which needed the same split treatment despite not being
part of this expansion at all. Fixed by splitting each overloaded slide
along the deck's existing `---` convention — new headings, no facts
removed — never by cutting content to make it fit, consistent with the same
research-before-writing standard that put the content there. One slide's
worth of oversized wiki screenshots got a general fix instead of a
one-off: `theme.css` now caps inline deck images at 340px tall, since the
wiki serves screenshots at whatever resolution it happens to host them,
sometimes well over 1900px wide. A clean re-run confirmed all twelve decks
fit
([`7cc3391`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass2-Da-W1nn3r/commit/7cc3391)).

The check earned a permanent place in the repo rather than being thrown away
once the immediate fixes landed: `scripts/check-deck-overflow.ts`, wired up
as `pnpm check:overflow`, so a future deck edit can be checked the same way
without re-deriving any of this. The Windows-specific CLI bug and the
workaround (`puppeteer-core` driving Chrome directly, `findChrome()`'s
Windows gap covered by an Edge-path fallback) are documented in `CLAUDE.md`
next to the existing Windows build-hook limitation, rather than left as
tribal knowledge.
