#!/usr/bin/env node
// Drives a real headless Chromium browser over every slide of every deck and
// reports content that overflows or is clipped by the fixed 1280x720 canvas
// (see astromotion's `measureSlide`/`TEXT_SELECTOR`, which this reuses).
//
// astromotion ships this exact check as the `astromotion-check` bin, but its
// CLI wrapper spawns its own `astro dev` server via
// `spawn("npx", ..., { shell: process.platform === "win32" })` --- on Windows
// that throws an unhandled `spawn npx ENOENT` and crashes the process before
// it ever launches a browser, even with shell:true set. This is a separate
// bug from the astro-theme-university build-hook issue documented in
// CLAUDE.md (that one uses execFile with no shell at all). Until upstream
// fixes it, this script bypasses the CLI wrapper entirely: it reuses
// astromotion's own exported measurement function directly, against a dev
// server you start yourself.
//
// Usage:
//   pnpm dev                    # in one terminal, leave it running
//   pnpm check:overflow         # all decks, in another
//   pnpm check:overflow week-05 # just one deck
//
// On Windows, also set ASTROMOTION_CHROME_PATH to a real Chromium browser ---
// astromotion's own findChrome() only checks macOS/Linux paths and
// puppeteer's own download cache, so on Windows it finds nothing unless told
// where to look. Microsoft Edge (Chromium-based, ships with Windows) works,
// e.g. (PowerShell):
//   $env:ASTROMOTION_CHROME_PATH = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
import { existsSync } from "node:fs";
import { chromeArgs, findChrome } from "astromotion/src/chrome.mjs";
import { measureSlide, TEXT_SELECTOR } from "astromotion/src/deck-check.mjs";
import puppeteer from "puppeteer-core";
import { gitOrigin, resolveDeployment } from "./pages-base.ts";

const WINDOWS_EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

function findChromeWindowsFallback(): string | undefined {
  if (process.platform !== "win32") return undefined;
  return WINDOWS_EDGE_PATHS.find((p) => existsSync(p));
}

const chromePath: string | undefined = findChrome() ?? findChromeWindowsFallback();
if (!chromePath) {
  console.error(
    "No Chromium browser found. Set ASTROMOTION_CHROME_PATH to a real Chrome/Edge/Chromium executable.",
  );
  process.exit(1);
}

const { base: sitePath } = resolveDeployment(process.env, gitOrigin);
const base = `http://localhost:${process.env.PORT ?? 4321}${sitePath}`;

const ALL_SLUGS = [
  "week-01", "week-02", "week-03", "week-04", "week-05", "week-06",
  "week-07", "week-08", "week-09", "week-10", "week-11", "week-12",
];
const slugs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ALL_SLUGS;
const TOLERANCE = 4;

interface Result {
  deck: string;
  slide?: number;
  heading?: string;
  rule?: string;
  detail?: string;
  error?: string;
}

const browser = await puppeteer.launch({
  executablePath: chromePath,
  args: chromeArgs(),
  headless: true,
});
const page = await browser.newPage();
await page.setViewport({ height: 720, width: 1280 });

const results: Result[] = [];
for (const slug of slugs) {
  const url = `${base}/decks/${slug}/`;
  let response;
  try {
    response = await page.goto(url, { waitUntil: "networkidle0" });
  } catch (err) {
    results.push({ deck: slug, error: (err as Error).message });
    continue;
  }
  if (!response?.ok()) {
    results.push({ deck: slug, error: `HTTP ${response?.status() ?? "?"}` });
    continue;
  }
  await page.waitForSelector(".reveal .slides > section", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  const count = await page.evaluate(
    () => document.querySelectorAll(".reveal .slides > section").length,
  );
  for (let i = 0; i < count; i++) {
    await page.evaluate((n) => {
      location.hash = `#/${n}`;
    }, i + 1);
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    const measured = await page.evaluate(measureSlide, TEXT_SELECTOR, TOLERANCE);
    for (const v of measured.violations ?? []) {
      results.push({ deck: slug, slide: i + 1, heading: measured.heading, rule: v.rule, detail: v.detail });
    }
  }
}
await browser.close();

if (results.length === 0) {
  console.log("✓ All slides fit.");
} else {
  console.log(`✗ ${results.length} issue(s):`);
  for (const r of results) {
    if (r.error) console.log(`  ${r.deck}: ${r.error}`);
    else console.log(`  ${r.deck} slide ${r.slide} "${r.heading}" — ${r.rule}: ${r.detail}`);
  }
  process.exitCode = 1;
}
