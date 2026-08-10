import { db } from "@/lib/db";
import { generateQuiz, QuizGenerationError } from "@/lib/quizGenerator";
import { getCourseCatalog, resolveSourceSelection, CourseCatalogError } from "@/lib/courseCatalog";

const ALLOWED_DIFFICULTIES = new Set(["beginner", "intermediate", "advanced", "mixed"]);
const ALLOWED_QUESTION_COUNTS = new Set([5, 8, 10, 15, 20, 25, 30, 35]);

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const weekIds = Array.isArray(body?.weekIds) ? body.weekIds.filter((id: unknown) => typeof id === "string") : [];
  const topics: string[] = Array.isArray(body?.topics)
    ? body.topics.filter((t: unknown) => typeof t === "string" && t.trim() !== "")
    : [];
  const questionCount = Number(body?.questionCount ?? 8);
  const difficulty = typeof body?.difficulty === "string" ? body.difficulty : "mixed";

  if (weekIds.length === 0) {
    return Response.json({ error: "Select at least one class week." }, { status: 400 });
  }
  if (!ALLOWED_QUESTION_COUNTS.has(questionCount)) {
    return Response.json({ error: "questionCount must be one of 5, 8, 10, 15, 20, 25, 30, 35." }, { status: 400 });
  }
  if (!ALLOWED_DIFFICULTIES.has(difficulty)) {
    return Response.json(
      { error: "difficulty must be beginner, intermediate, advanced, or mixed." },
      { status: 400 }
    );
  }

  try {
    const catalog = await getCourseCatalog();
    const knownWeekIds = new Set(catalog.map((week) => week.id));
    if (!weekIds.every((id: string) => knownWeekIds.has(id))) {
      return Response.json({ error: "One or more selected weeks were not found." }, { status: 400 });
    }

    const { sourceIds, sourceGroups, coverageLabel } = resolveSourceSelection(
      catalog,
      weekIds,
      topics.length > 0 ? topics : null
    );
    if (sourceIds.length === 0) {
      return Response.json(
        { error: "No indexed class notes match that week/topic combination. Try 'All topics'." },
        { status: 400 }
      );
    }

    const topicLabel = topics.length > 0 ? topics.join(", ") : "all topics";
    const prompt =
      `Generate ${questionCount} Bhagavatam class quiz questions covering ${coverageLabel}. ` +
      `Focus on ${topicLabel}. Use only the indexed class notes and infographics from the selected ` +
      `class weeks as source context. Difficulty: ${difficulty}. Include a balanced mix of recall, ` +
      `connection, and reflection.`;

    const generated = await generateQuiz({
      prompt,
      questionCount,
      difficulty: difficulty as "beginner" | "intermediate" | "advanced" | "mixed",
      topic: topics.length > 0 ? topicLabel : null,
      coverageLabel,
      sourceIds,
      sourceGroups,
    });

    const quiz = await db.quiz.create({
      data: {
        title: generated.title || `${coverageLabel} · ${topicLabel}`,
        description: generated.description,
        status: "DRAFT",
        questions: {
          create: generated.questions.map((question, index) => ({
            order: index,
            type: question.type === "true_false" ? "TRUE_FALSE" : "MULTIPLE_CHOICE",
            question: question.question,
            choices: question.choices,
            answer: question.answer,
            explanation: question.explanation,
          })),
        },
      },
      select: {
        id: true,
        title: true,
        status: true,
        questions: {
          orderBy: { order: "asc" },
          select: { id: true, order: true, type: true, question: true, choices: true, answer: true, explanation: true },
        },
      },
    });

    return Response.json(quiz);
  } catch (error) {
    if (error instanceof QuizGenerationError || error instanceof CourseCatalogError) {
      return Response.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}
