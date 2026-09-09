import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface ApiNode {
  id: string;
  type: string;
  meta?: Record<string, unknown>;
}

interface CourseApi {
  nodes: ApiNode[];
}

const api = JSON.parse(readFileSync(resolve("dist/api/index.json"), "utf8")) as CourseApi;
const WEEKS = 12;

describe("course content promises", () => {
  it("weights every assessment to sum to exactly 100", () => {
    const assessments = api.nodes.filter((node) => node.type === "assessments");
    const total = assessments.reduce((sum, node) => sum + Number(node.meta?.weight ?? 0), 0);
    expect(total).toBe(100);
  });

  it("covers every teaching week with exactly one tutorial and one lecture", () => {
    for (let week = 1; week <= WEEKS; week++) {
      const sessions = api.nodes.filter(
        (node) => node.type === "sessions" && node.meta?.week === week,
      );
      const lectures = api.nodes.filter(
        (node) => node.type === "lectures" && node.meta?.week === week,
      );
      expect(sessions, `week ${week} tutorials`).toHaveLength(1);
      expect(lectures, `week ${week} lectures`).toHaveLength(1);
    }
  });

  it("links at least one lecture to a real slide deck", () => {
    const lecturesWithSlides = api.nodes.filter(
      (node) => node.type === "lectures" && typeof node.meta?.slides === "string",
    );
    expect(lecturesWithSlides.length).toBeGreaterThan(0);

    const resolvesToFile = lecturesWithSlides.some((node) => {
      const slidesPath = String(node.meta?.slides).replace(/^\/decks\//, "").replace(/\/$/, "");
      return existsSync(resolve("src/decks", `${slidesPath}.deck.mdx`));
    });
    expect(resolvesToFile).toBe(true);
  });

  it("gives every tutorial a non-empty practical and goal", () => {
    const sessions = api.nodes.filter((node) => node.type === "sessions");
    expect(sessions).toHaveLength(WEEKS);
    for (const node of sessions) {
      expect(String(node.meta?.practical ?? "").length, `${node.id} practical`).toBeGreaterThan(
        0,
      );
      expect(String(node.meta?.goal ?? "").length, `${node.id} goal`).toBeGreaterThan(0);
    }
  });
});
