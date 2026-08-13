import { db } from "@/lib/db";
import { generateQuiz, QuizGenerationError, type GenerationProgress } from "@/lib/localQuizGenerator";
import { resolveGenerateQuizRequest } from "@/lib/generateQuizRequest";

const HEARTBEAT_INTERVAL_MS = 15_000;

export async function POST(request: Request) {
  const parsed = await resolveGenerateQuizRequest(request);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: parsed.status });
  }
  const { questionCount, difficulty, scopeTopics, coverageLabel, sourceText, existingQuestions } = parsed.value;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      // Independent of how often generation progress actually fires — keeps
      // the browser-facing connection visibly alive through slow phases.
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(":heartbeat\n\n"));
      }, HEARTBEAT_INTERVAL_MS);

      try {
        const generated = await generateQuiz({
          topics: scopeTopics,
          sourceText,
          questionCount,
          difficulty,
          coverageLabel,
          existingQuestions,
          onProgress: (progress: GenerationProgress) => send("progress", progress),
        });

        const quiz = await db.quiz.create({
          data: {
            title: generated.title,
            description: generated.description,
            status: "DRAFT",
            questions: {
              create: generated.questions.map((question, index) => ({
                order: index,
                type: question.type === "true_false" ? "TRUE_FALSE" : "MULTIPLE_CHOICE",
                question: question.question,
                choices: question.choices,
                correctChoices: [question.answer],
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
              select: {
                id: true,
                order: true,
                type: true,
                question: true,
                choices: true,
                correctChoices: true,
                explanation: true,
              },
            },
          },
        });

        send("complete", quiz);
      } catch (error) {
        if (error instanceof QuizGenerationError) {
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
