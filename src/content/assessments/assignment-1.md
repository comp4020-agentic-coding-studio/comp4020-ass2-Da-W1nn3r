---
title: Assignment 1
description:
  A bottleneck-diagnosis report on a supplied mid-game save, covering
  everything from balancer theory to rail intersections.
week: 8
due: 2026-09-25T12:00:00+10:00
weight: 20
marking:
  mode: weighted
  criteria:
    - name: Diagnosis accuracy
      weight: 50
    - name: Fix quality and justification
      weight: 50
spec:
  - submitted by the deadline, as a save file plus a written report
  - the report correctly identifies the save's actual bottleneck, not a
    plausible-sounding but wrong one
  - any proposed fix is justified with ratios or measurements, not vibes
  - the work is yours, with any assistance declared
related:
  - group-project
---

## The brief

> You are handed a save that runs, but under-produces. Find out why, and fix
> it.

The supplied base looks fine at a glance — belts are full, furnaces are
smoking, nothing is on fire. The point of this assignment is that "looks
fine" and "is fine" are different claims. Somewhere in the chain from ore to
finished product there is a ratio that doesn't hold, a buffer that's
starved, or a splitter quietly feeding one side more than the other. Your
job is to find the actual constraint — the one thing that, if relieved,
raises overall output — and say how you know it's that one and not
something else that merely looks suspicious.

## What you submit

Your modified save file, plus a short written report: what the bottleneck
was, the measurements or ratios that prove it, the fix you applied, and the
throughput before and after. A report that names the right bottleneck but
can't show its working scores lower than one that shows the working, even if
the fix is the same.
