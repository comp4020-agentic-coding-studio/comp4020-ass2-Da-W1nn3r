---
title: Base Design Philosophy
description:
  Furnace stacks and footprint trade-offs, then the named layout styles —
  spaghetti, bus, bot base, tileable base, train base — and what each buys
  and costs.
week: 2
date: 2026-08-03
teachers:
  - naledi-osei
related:
  - sessions/02-two-bases-one-verdict
---

## Outline

- **Furnace stacks** — compact multi-row smelting, and how inserter reach
  and belt-side placement determine how many furnaces one belt pair can
  feed.
- **Base design and footprint** — footprint as a deliberate design
  variable: smaller means less travel and cheaper infrastructure, but
  harder to expand later.
- **Spaghetti** — the organic, unplanned style, and why it stops scaling
  once no one can trace a belt by eye.
- **The bus** — a small number of parallel main belts carrying core
  intermediates the length of the base, the first real architecture
  decision a base makes.
- **Bot base** — replacing belts with logistics robots and storage/requester
  chests, trading routing complexity for power and robot overhead.
- **Tileable base** — repeatable, blueprint-sized production blocks that
  copy-paste cleanly.
- **Train base and megabases** — trains and stations as the bus between
  distant outposts once one map area can't supply everything.
