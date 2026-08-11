import { afterEach, describe, expect, it, vi } from "vitest";
import { getCourseCatalog, resolveSourceSelection, toPublicCourseWeeks, type CourseWeek } from "@/lib/courseCatalog";

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
  it("offers the full catalog topic list for a week with indexed documents, not just heading matches", () => {
    const [publicWeek] = toPublicCourseWeeks([week()]);
    expect(publicWeek.topics).toEqual(["Sanatana Dharma", "Dharma", "Vedas"]);
  });

  it("excludes a week entirely when it has zero indexed documents", () => {
    const publicWeeks = toPublicCourseWeeks([week({ sourceDocuments: [] })]);
    expect(publicWeeks).toEqual([]);
  });
});

describe("resolveSourceSelection", () => {
  it("scopes to the matching document when a topic matches a heading", () => {
    const { sourceIds } = resolveSourceSelection([week()], ["week-1"], ["Sanatana Dharma"]);
    expect(sourceIds).toEqual(["doc-1"]);
  });

  it("matches headings case-insensitively and trims whitespace", () => {
    const { sourceIds } = resolveSourceSelection([week()], ["week-1"], [" sanatana dharma "]);
    expect(sourceIds).toEqual(["doc-1"]);
  });

  it("falls back to the week's full document set when the topic isn't a literal heading, instead of an empty scope", () => {
    const { sourceIds } = resolveSourceSelection([week()], ["week-1"], ["Dharma"]);
    expect(sourceIds).toEqual(["doc-1"]);
  });

  it("still excludes a week that has no indexed documents at all", () => {
    const { sourceIds } = resolveSourceSelection([week({ sourceDocuments: [] })], ["week-1"], ["Dharma"]);
    expect(sourceIds).toEqual([]);
  });
});

describe("getCourseCatalog", () => {
  const originalEnv = process.env.QUIZ_GENERATOR_API_URL;

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.QUIZ_GENERATOR_API_URL = originalEnv;
  });

  it("resolves a document whose indexed source_file differs only by '+' vs space and by case", async () => {
    process.env.QUIZ_GENERATOR_API_URL = "https://example.test/api/quiz/generate";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            knowledge_base: {
              sources: [{ id: "week-4-eng-sb-course-2-pdf-abc123", source_file: "week+4-eng-sb+course+2+pdf.pdf" }],
            },
          }),
          { status: 200 }
        )
      )
    );

    const weeks = await getCourseCatalog();
    const week4 = weeks.find((week) => week.id === "week-4");
    const notesDoc = week4?.sourceDocuments.find((doc) => doc.name === "Week 4-ENG-SB Course 2 PDF.pdf");
    expect(notesDoc?.id).toBe("week-4-eng-sb-course-2-pdf-abc123");
  });
});
