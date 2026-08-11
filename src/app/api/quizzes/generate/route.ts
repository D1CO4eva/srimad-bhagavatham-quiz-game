import { db } from "@/lib/db";
import { generateQuiz, QuizGenerationError, type GenerationProgress } from "@/lib/quizGenerator";
import { getCourseCatalog, resolveSourceSelection, CourseCatalogError } from "@/lib/courseCatalog";

const ALLOWED_DIFFICULTIES = new Set(["beginner", "intermediate", "advanced", "mixed"]);
const ALLOWED_QUESTION_COUNTS = new Set([5, 8, 10, 15, 20, 25, 30, 35]);
const HEARTBEAT_INTERVAL_MS = 15_000;

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

  // Catalog/source resolution is fast and synchronous-ish (a couple of
  // cached fetches) — worth failing fast here with a plain JSON error
  // rather than opening a stream just to immediately error out of it. Only
  // the genuinely slow part (LLM generation) below becomes a stream.
  let sourceIds: string[];
  let sourceGroups: ReturnType<typeof resolveSourceSelection>["sourceGroups"];
  let coverageLabel: string;
  try {
    const catalog = await getCourseCatalog();
    const knownWeekIds = new Set(catalog.map((week) => week.id));
    if (!weekIds.every((id: string) => knownWeekIds.has(id))) {
      return Response.json({ error: "One or more selected weeks were not found." }, { status: 400 });
    }
    ({ sourceIds, sourceGroups, coverageLabel } = resolveSourceSelection(
      catalog,
      weekIds,
      topics.length > 0 ? topics : null
    ));
    if (sourceIds.length === 0) {
      return Response.json(
        { error: "No indexed class notes match that week/topic combination. Try 'All topics'." },
        { status: 400 }
      );
    }
  } catch (error) {
    if (error instanceof CourseCatalogError) {
      return Response.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }

  const topicLabel = topics.length > 0 ? topics.join(", ") : "all topics";
  const prompt =
    `Generate ${questionCount} Bhagavatam class quiz questions covering ${coverageLabel}. ` +
    `Focus on ${topicLabel}. Use only the indexed class notes and infographics from the selected ` +
    `class weeks as source context. Difficulty: ${difficulty}. Include a balanced mix of recall, ` +
    `connection, and reflection.`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      // Independent of how often generation progress actually fires — keeps
      // the browser-facing connection visibly alive through slow phases,
      // same as GOD-Auth-Service does for us on the upstream hop.
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(":heartbeat\n\n"));
      }, HEARTBEAT_INTERVAL_MS);

      try {
        const generated = await generateQuiz({
          prompt,
          questionCount,
          difficulty: difficulty as "beginner" | "intermediate" | "advanced" | "mixed",
          topic: topics.length > 0 ? topicLabel : null,
          coverageLabel,
          sourceIds,
          sourceGroups,
          onProgress: (progress: GenerationProgress) => send("progress", progress),
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

        send("complete", quiz);
      } catch (error) {
        if (error instanceof QuizGenerationError || error instanceof CourseCatalogError) {
          send("error", { error: error.message });
        } else {
          console.error("Unexpected error during quiz generation:", error);
          send("error", { error: "Unexpected server error while generating the quiz." });
        }
      } finally {
        clearInterval(heartbeat);
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
