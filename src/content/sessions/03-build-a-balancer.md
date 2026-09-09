---
title: Build a Balancer
description:
  Design a 5-belt-to-4-belt balancer from splitters and underground belts,
  then prove it holds under an uneven input.
week: 3
date: 2026-08-10
teachers:
  - rowan-achterberg
practical:
  Design a working 5-belt-to-4-belt balancer using only splitters and
  underground belts, and verify it distributes load evenly regardless of
  which input lane is starved.
goal:
  Develop logistics problem-solving skills — reasoning about flow through a
  network rather than just placing entities down.
spec:
  - the balancer accepts 5 input belts and produces 4 evenly loaded output
    belts
  - output stays even when any single input lane is starved, demonstrated
    live
  - only splitters and underground belts were used
related:
  - lectures/week-03
---

## Before the tutorial

Bring last week's save. You'll need a clear patch of floor and a supply of
belts, splitters and underground belts.

## In the tutorial

Build your balancer, then starve one input lane at a time and confirm the
outputs stay even. A balancer that only works with all five inputs full is
not a pass.

## Afterwards

Keep the blueprint — Weeks 6 and 10 both reuse balancer theory at larger
scale.
