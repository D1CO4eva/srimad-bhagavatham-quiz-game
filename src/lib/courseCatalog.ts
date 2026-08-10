/**
 * Reads the static course catalog (weeks -> topics -> source documents) that
 * describes the indexed Bhagavatam class notes, and cross-references it
 * against GOD-Auth-Service's own knowledge-base index (its /api/quiz/health
 * endpoint) to resolve the *actual* source ids its RAG pipeline expects —
 * the catalog's own document ids don't match what the service indexed them
 * under (it appends a content hash), so retrieval scoping has to go through
 * this lookup rather than the catalog ids directly.
 */

const CATALOG_FETCH_OPTS = { next: { revalidate: 300 } } as const;

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
  const response = await fetch(url, CATALOG_FETCH_OPTS).catch((error: unknown) => {
    throw new CourseCatalogError(
      `Could not reach ${label}: ${error instanceof Error ? error.message : String(error)}`
    );
  });
  if (!response.ok) {
    throw new CourseCatalogError(`${label} returned HTTP ${response.status}.`);
  }
  return response.json();
}

export async function getCourseCatalog(): Promise<CourseWeek[]> {
  const catalogUrl = process.env.COURSE_CATALOG_URL;
  const generateUrl = process.env.QUIZ_GENERATOR_API_URL;
  if (!catalogUrl) throw new CourseCatalogError("COURSE_CATALOG_URL is not set.");
  if (!generateUrl) throw new CourseCatalogError("QUIZ_GENERATOR_API_URL is not set.");

  const [catalog, health] = await Promise.all([
    fetchJson(catalogUrl, "the course catalog") as Promise<{
      weeks: {
        id: string;
        label: string;
        topics: string[];
        source_documents: { id: string; name: string; topics_from_headings: string[] }[];
      }[];
    }>,
    fetchJson(deriveHealthUrl(generateUrl), "the quiz generator's health endpoint") as Promise<{
      knowledge_base?: { sources?: { id: string; source_file: string }[] };
    }>,
  ]);

  const indexedIdByFileName = new Map<string, string>();
  for (const source of health.knowledge_base?.sources ?? []) {
    indexedIdByFileName.set(source.source_file, source.id);
  }

  return catalog.weeks.map((week) => ({
    id: week.id,
    label: week.label,
    topics: week.topics,
    sourceDocuments: week.source_documents
      .map((doc) => ({
        id: indexedIdByFileName.get(doc.name) ?? "",
        name: doc.name,
        topicsFromHeadings: doc.topics_from_headings,
      }))
      .filter((doc) => doc.id !== ""),
  }));
}

export function toPublicCourseWeeks(weeks: CourseWeek[]): PublicCourseWeek[] {
  return weeks.map((week) => ({ id: week.id, label: week.label, topics: week.topics }));
}

export function resolveSourceSelection(
  weeks: CourseWeek[],
  weekIds: string[],
  topics: string[] | null
): { sourceIds: string[]; sourceGroups: SourceGroup[]; coverageLabel: string } {
  const selectedWeeks = weeks.filter((week) => weekIds.includes(week.id));

  const sourceGroups = selectedWeeks
    .map((week) => ({
      id: week.id,
      label: week.label,
      source_ids: (topics && topics.length > 0
        ? week.sourceDocuments.filter((doc) => doc.topicsFromHeadings.some((heading) => topics.includes(heading)))
        : week.sourceDocuments
      ).map((doc) => doc.id),
    }))
    .filter((group) => group.source_ids.length > 0);

  const sourceIds = [...new Set(sourceGroups.flatMap((group) => group.source_ids))];
  const coverageLabel =
    selectedWeeks.length > 1 ? selectedWeeks.map((week) => week.label).join(" + ") : (selectedWeeks[0]?.label ?? "");

  return { sourceIds, sourceGroups, coverageLabel };
}
