/**
 * Reads this app's own course catalog (weeks -> topics -> source documents),
 * generated from srimadbhagavatamcourse.org's notes/infographics by
 * scripts/build_course_catalog.py (see src/data/courseCatalog.json) — not
 * the shared self-study catalog other apps use, so this app's topic picker
 * doesn't depend on a separately-maintained curation pass.
 *
 * Cross-references it against GOD-Auth-Service's own knowledge-base index
 * (its /api/quiz/health endpoint) to resolve the *actual* source ids its RAG
 * pipeline expects — GOD-Auth-Service indexes documents under its own ids
 * (it appends a content hash), so retrieval scoping has to go through this
 * lookup by filename rather than using this catalog's ids directly. Names
 * are matched with normalizeFileName() rather than exact equality, since the
 * two catalogs are maintained independently and can differ in case or in
 * "+" vs " " (a common artifact of saving a URL-encoded filename verbatim).
 */

import localCatalog from "@/data/courseCatalog.json";

const HEALTH_FETCH_OPTS = { next: { revalidate: 300 } } as const;

export type CourseSourceDocument = {
  id: string;
  name: string;
  topicsFromHeadings: string[];
};

export type CourseWeek = {
  id: string;
  label: string;
  topics: string[];
  sourceDocuments: CourseSourceDocument[];
};

export type PublicCourseWeek = {
  id: string;
  label: string;
  topics: string[];
};

/**
 * The catalog only labels weeks "Week N" — not enough for a host picking a
 * week to know what's actually in it. Derived by hand from each week's own
 * topic list in src/data/courseCatalog.json; not generated automatically,
 * so this needs a human check whenever the catalog is rebuilt with new
 * content (see scripts/build_course_catalog.py).
 */
const WEEK_SUMMARIES: Record<string, string> = {
  "week-1": "Sanatana Dharma Overview",
  "week-2": "Prasthana Traya",
  "week-3": "Bhagavatam Mahatmyam",
  "week-4": "Structure & Lineage",
  "week-5": "Canto 1 Overview",
  "week-6": "Canto 1 Answers & Narada-Vyasa Dialogue",
};

export type SourceGroup = {
  id: string;
  label: string;
  source_ids: string[];
};

export class CourseCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CourseCatalogError";
  }
}

function deriveHealthUrl(generateUrl: string): string {
  return generateUrl.replace(/\/generate\/?$/, "/health");
}

async function fetchJson(url: string, label: string): Promise<unknown> {
  const response = await fetch(url, HEALTH_FETCH_OPTS).catch((error: unknown) => {
    throw new CourseCatalogError(
      `Could not reach ${label}: ${error instanceof Error ? error.message : String(error)}`
    );
  });
  if (!response.ok) {
    throw new CourseCatalogError(`${label} returned HTTP ${response.status}.`);
  }
  return response.json();
}

// "+"-for-space is a common artifact of saving a URL-encoded filename
// verbatim (e.g. a Squarespace asset URL's "Week+4-ENG-SB+Course.pdf"), and
// the two catalogs (this one and whatever GOD-Auth-Service indexed) are
// maintained independently, so tolerate case and that one substitution
// rather than requiring byte-for-byte identical names.
function normalizeFileName(name: string): string {
  return name.replace(/\+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

export async function getCourseCatalog(): Promise<CourseWeek[]> {
  const generateUrl = process.env.QUIZ_GENERATOR_API_URL;
  if (!generateUrl) throw new CourseCatalogError("QUIZ_GENERATOR_API_URL is not set.");

  const health = (await fetchJson(deriveHealthUrl(generateUrl), "the quiz generator's health endpoint")) as {
    knowledge_base?: { sources?: { id: string; source_file: string }[] };
  };

  const indexedIdByFileName = new Map<string, string>();
  for (const source of health.knowledge_base?.sources ?? []) {
    indexedIdByFileName.set(normalizeFileName(source.source_file), source.id);
  }

  return localCatalog.weeks.map((week) => ({
    id: week.id,
    label: week.label,
    topics: week.topics,
    sourceDocuments: week.source_documents
      .map((doc) => ({
        id: indexedIdByFileName.get(normalizeFileName(doc.name)) ?? "",
        name: doc.name,
        topicsFromHeadings: doc.topics_from_headings,
      }))
      .filter((doc) => doc.id !== ""),
  }));
}

export function toPublicCourseWeeks(weeks: CourseWeek[]): PublicCourseWeek[] {
  // Only offer weeks that have at least one indexed document — an
  // unindexed week can never be grounded, so it shouldn't be pickable at
  // all. Topics themselves aren't filtered against document headings here:
  // most course topics live in the body text of the notes, not as their
  // own heading, so a heading-only filter was hiding real topics (see
  // resolveSourceSelection's fallback, which is what actually keeps
  // generation grounded when a topic isn't a literal heading match).
  return weeks
    .filter((week) => week.sourceDocuments.length > 0)
    .map((week) => ({
      id: week.id,
      label: WEEK_SUMMARIES[week.id] ? `${week.label} · ${WEEK_SUMMARIES[week.id]}` : week.label,
      topics: week.topics,
    }));
}

function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase();
}

export function resolveSourceSelection(
  weeks: CourseWeek[],
  weekIds: string[],
  topics: string[] | null
): { sourceIds: string[]; sourceGroups: SourceGroup[]; coverageLabel: string } {
  const selectedWeeks = weeks.filter((week) => weekIds.includes(week.id));
  const normalizedTopics = topics && topics.length > 0 ? topics.map(normalizeTopic) : null;

  const sourceGroups = selectedWeeks
    .map((week) => {
      const topicMatchedDocs = normalizedTopics
        ? week.sourceDocuments.filter((doc) =>
            doc.topicsFromHeadings.some((heading) => normalizedTopics.includes(normalizeTopic(heading)))
          )
        : week.sourceDocuments;
      // A topic that doesn't literally match a document heading is still a
      // real course topic in most cases (see toPublicCourseWeeks) — fall
      // back to the week's full document set rather than an empty scope,
      // which the RAG service can't ground anything on.
      const documents = topicMatchedDocs.length > 0 ? topicMatchedDocs : week.sourceDocuments;
      return {
        id: week.id,
        label: week.label,
        source_ids: documents.map((doc) => doc.id),
      };
    })
    .filter((group) => group.source_ids.length > 0);

  const sourceIds = [...new Set(sourceGroups.flatMap((group) => group.source_ids))];
  const coverageLabel =
    selectedWeeks.length > 1 ? selectedWeeks.map((week) => week.label).join(" + ") : (selectedWeeks[0]?.label ?? "");

  return { sourceIds, sourceGroups, coverageLabel };
}
