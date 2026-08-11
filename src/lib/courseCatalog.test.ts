import { describe, expect, it } from "vitest";
import { getCourseCatalog, getSourceText, resolveGenerationScope, toPublicCourseWeeks, type CourseWeek } from "@/lib/courseCatalog";

function week(overrides: Partial<CourseWeek> = {}): CourseWeek {
  return {
    id: "week-1",
    label: "Week 1",
    topics: ["Sanatana Dharma", "Dharma", "Vedas"],
    sourceDocuments: [
      {
        id: "doc-1",
        name: "Week 1 Notes.pdf",
        topicsFromHeadings: ["Sanatana Dharma"],
      },
    ],
    ...overrides,
  };
}

describe("toPublicCourseWeeks", () => {
  it("offers the full catalog topic list for a week with source documents", () => {
    const [publicWeek] = toPublicCourseWeeks([week()]);
    expect(publicWeek.topics).toEqual(["Sanatana Dharma", "Dharma", "Vedas"]);
  });

  it("excludes a week entirely when it has zero source documents", () => {
    const publicWeeks = toPublicCourseWeeks([week({ sourceDocuments: [] })]);
    expect(publicWeeks).toEqual([]);
  });
});

describe("resolveGenerationScope", () => {
  it("scopes to the matching topic when a topic filter is given", () => {
    const { topics } = resolveGenerationScope([week()], ["week-1"], ["Sanatana Dharma"]);
    expect(topics).toEqual(["Sanatana Dharma"]);
  });

  it("matches topics case-insensitively and trims whitespace", () => {
    const { topics } = resolveGenerationScope([week()], ["week-1"], [" sanatana dharma "]);
    expect(topics).toEqual(["Sanatana Dharma"]);
  });

  it("falls back to the week's full topic list when the filter matches nothing, instead of an empty scope", () => {
    const { topics } = resolveGenerationScope([week()], ["week-1"], ["Something not in this week"]);
    expect(topics).toEqual(["Sanatana Dharma", "Dharma", "Vedas"]);
  });

  it("returns no topics for a week id that isn't in the catalog", () => {
    const { topics } = resolveGenerationScope([week()], ["week-99"], null);
    expect(topics).toEqual([]);
  });

  it("joins labels with '+' when multiple weeks are selected", () => {
    const weekTwo = week({ id: "week-2", label: "Week 2", topics: ["Bhagavan"] });
    const { coverageLabel } = resolveGenerationScope([week(), weekTwo], ["week-1", "week-2"], null);
    expect(coverageLabel).toBe("Week 1 + Week 2");
  });
});

describe("getCourseCatalog", () => {
  it("reads weeks/topics/source documents straight from the bundled catalog", async () => {
    const weeks = await getCourseCatalog();
    const weekOne = weeks.find((w) => w.id === "week-1");
    expect(weekOne?.label).toBe("Week 1");
    expect(weekOne?.topics).toContain("Sanatana Dharma");
    expect(weekOne?.sourceDocuments.length).toBeGreaterThan(0);
  });
});

describe("getSourceText", () => {
  it("returns an empty string when none of a week's source documents have extracted text", () => {
    expect(getSourceText([week()], ["week-1"])).toBe("");
  });

  it("returns an empty string for a week id that isn't in the catalog", () => {
    expect(getSourceText([week()], ["week-99"])).toBe("");
  });

  it("includes the real week's course-note text when it's actually bundled", async () => {
    const weeks = await getCourseCatalog();
    const text = getSourceText(weeks, ["week-1"]);
    expect(text).toContain("Sanatana Dharma");
    expect(text.length).toBeGreaterThan(100);
  });
});
