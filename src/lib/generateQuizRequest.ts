/**
 * Shared request validation + catalog scoping for the two quiz-generation
 * entry points (src/app/generate-quiz/route.ts and
 * src/app/api/quizzes/generate/route.ts) so the two don't drift on what
 * counts as a valid request.
 */

import { getCourseCatalog, resolveGenerationScope, getSourceText } from "@/lib/courseCatalog";

export const ALLOWED_DIFFICULTIES = new Set(["beginner", "intermediate", "advanced", "mixed"]);
export const ALLOWED_QUESTION_COUNTS = new Set([5, 8, 10, 15, 20, 25, 30, 35]);

export type Difficulty = "beginner" | "intermediate" | "advanced" | "mixed";

export type GenerateQuizRequest = {
  weekIds: string[];
  requestedTopics: string[];
  questionCount: number;
  difficulty: Difficulty;
  scopeTopics: string[];
  coverageLabel: string;
  sourceText: string;
};

export type GenerateQuizRequestResult =
  | { ok: true; value: GenerateQuizRequest }
  | { ok: false; error: string; status: number };

export async function resolveGenerateQuizRequest(request: Request): Promise<GenerateQuizRequestResult> {
  const body = await request.json().catch(() => null);
  const weekIds: string[] = Array.isArray(body?.weekIds)
    ? body.weekIds.filter((id: unknown) => typeof id === "string")
    : [];
  const requestedTopics: string[] = Array.isArray(body?.topics)
    ? body.topics.filter((t: unknown) => typeof t === "string" && t.trim() !== "")
    : [];
  const questionCount = Number(body?.questionCount ?? 8);
  const difficulty = typeof body?.difficulty === "string" ? body.difficulty : "mixed";

  if (weekIds.length === 0) {
    return { ok: false, error: "Select at least one class week.", status: 400 };
  }
  if (!ALLOWED_QUESTION_COUNTS.has(questionCount)) {
    return { ok: false, error: "questionCount must be one of 5, 8, 10, 15, 20, 25, 30, 35.", status: 400 };
  }
  if (!ALLOWED_DIFFICULTIES.has(difficulty)) {
    return { ok: false, error: "difficulty must be beginner, intermediate, advanced, or mixed.", status: 400 };
  }

  const catalog = await getCourseCatalog();
  const knownWeekIds = new Set(catalog.map((week) => week.id));
  if (!weekIds.every((id) => knownWeekIds.has(id))) {
    return { ok: false, error: "One or more selected weeks were not found.", status: 400 };
  }

  const { topics: scopeTopics, coverageLabel } = resolveGenerationScope(
    catalog,
    weekIds,
    requestedTopics.length > 0 ? requestedTopics : null
  );
  if (scopeTopics.length === 0) {
    return { ok: false, error: "No topics found for that week/topic combination. Try 'All topics'.", status: 400 };
  }

  const sourceText = getSourceText(catalog, weekIds);

  return {
    ok: true,
    value: {
      weekIds,
      requestedTopics,
      questionCount,
      difficulty: difficulty as Difficulty,
      scopeTopics,
      coverageLabel,
      sourceText,
    },
  };
}
