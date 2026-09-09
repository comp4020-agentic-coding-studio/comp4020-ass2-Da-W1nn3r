---
title: Bidirectional Rail Line
description:
  Design a three-lane rail line with a bidirectional middle lane, and
  verify it under simulated traffic from both directions.
week: 6
date: 2026-08-31
teachers:
  - rowan-achterberg
practical:
  Design a three-lane rail line where the middle lane runs
  bi-directionally, and verify it under simulated traffic from both
  directions.
goal:
  Learn to design train networks that scale without deadlocking.
spec:
  - the middle lane carries trains in both directions without a deadlock
  - signalling is demonstrated holding under simultaneous opposing traffic
  - the design is explained in terms of signal blocks, not trial and error
related:
  - lectures/week-06
---

## Before the tutorial

Bring last week's save. You'll need rail, signals and at least two trains
to test with.

## In the tutorial

Build the three-lane line, then run trains from both directions on the
middle lane at once and confirm nothing deadlocks.

## Afterwards

Next week's groups will need someone to own exactly this — rail network
rules are one of the roles Week 7 asks a team to allocate.
