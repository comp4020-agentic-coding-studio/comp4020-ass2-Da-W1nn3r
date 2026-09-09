---
title: Jam-Free Uranium
description:
  Design a circuit-controlled uranium processing setup that runs
  continuously without jamming or starving under normal supply variation.
week: 10
date: 2026-10-05
teachers:
  - yusuf-cardente
practical:
  Design a uranium processing setup, controlled with circuit logic, that
  runs continuously without jamming or starving under normal supply
  variation.
goal:
  Apply advanced circuit-network optimisation to a system where a jam has
  real consequences.
spec:
  - the setup runs unattended through a supply-rate change without
    jamming
  - at least one circuit condition (not a fixed timer) governs part of
    the process
  - the failure mode the circuit logic is guarding against is stated
related:
  - lectures/week-10
---

## Before the tutorial

Bring last week's save, with a uranium ore supply already reaching your
build site.

## In the tutorial

Build the processing setup, wire in the circuit conditions that keep it
from jamming or starving, and vary the ore supply rate to confirm it
holds.

## Afterwards

Keep notes on which circuit condition mattered most — Week 12's TPS audit
looks at setups like this from a performance angle, not just a
reliability one.
