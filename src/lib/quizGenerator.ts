/**
 * Calls GOD-Auth-Service's course-note RAG quiz generator
 * (POST /api/quiz/generate) — a separate, already-deployed service that
 * retrieves relevant Bhagavatam course-note chunks and asks an LLM to
 * generate a source-grounded quiz, then independently re-validates every
 * question against its cited passages before returning it (95% confidence
 * floor, reject-and-regenerate on failure). This app does none of that
 * grounding work itself — it only imports the already-validated result.
 *
 * Restricted to multiple_choice/true_false: those are the only types the
 * live tap UI can render (see Answer model's comment in schema.prisma).
 * bhagavatham-class-quiz-generator applies the same restriction itself.
 *
 * topic/sourceIds/sourceGroups scope retrieval to the host's chosen class
 * week(s)/topic (resolved via src/lib/courseCatalog.ts) — without them the
 * service falls back to retrieving across the whole indexed corpus, which
 * is not what "generate from Week 3" should do. Same fields
 * bhagavatham-class-quiz-generator sends.
 */

import { nanoid } from "nanoid";
import type { SourceGroup } from "@/lib/courseCatalog";

const REQUEST_TIMEOUT_MS = 45_000;

export type GeneratedQuestion = {
  id: string;
  type: "multiple_choice" | "true_false";
  question: string;
  choices: string[];
  answer: string;
  explanation: string;
};

export type GeneratedQuiz = {
  title: string;
  description: string;
  questions: GeneratedQuestion[];
};

export class QuizGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuizGenerationError";
  }
}

export async function generateQuiz(params: {
  prompt: string;
  questionCount: number;
  difficulty: "beginner" | "intermediate" | "advanced" | "mixed";
  topic: string | null;
  coverageLabel: string;
  sourceIds: string[];
  sourceGroups: SourceGroup[];
}): Promise<GeneratedQuiz> {
  const apiUrl = process.env.QUIZ_GENERATOR_API_URL;
  if (!apiUrl) throw new QuizGenerationError("QUIZ_GENERATOR_API_URL is not set.");

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: params.prompt,
      topic: params.topic ?? "",
      coverage_label: params.coverageLabel,
      variation_id: nanoid(),
      question_count: params.questionCount,
      question_types: ["multiple_choice", "true_false"],
      difficulty: params.difficulty,
      language: "English",
      include_explanations: true,
      top_k: 8,
      source_ids: params.sourceIds,
      source_groups: params.sourceGroups,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new QuizGenerationError(
      error instanceof Error && error.name === "TimeoutError"
        ? "Quiz generation timed out."
        : `Could not reach the quiz generator: ${error instanceof Error ? error.message : String(error)}`
    );
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new QuizGenerationError(body.error ?? `Quiz generator returned HTTP ${response.status}.`);
  }

  const questions = (body?.quiz?.questions ?? []).filter(
    (question: { type?: string }) => question.type === "multiple_choice" || question.type === "true_false"
  );
  if (questions.length === 0) {
    throw new QuizGenerationError("The generator returned no usable multiple-choice/true-false questions.");
  }

  return {
    title: body.quiz.title || params.prompt.slice(0, 80),
    description: body.quiz.description ?? "",
    questions: questions.map((question: GeneratedQuestion) => ({
      id: question.id,
      type: question.type,
      question: question.question,
      choices: question.type === "true_false" ? ["True", "False"] : question.choices,
      answer: question.answer,
      explanation: question.explanation ?? "",
    })),
  };
}
