/**
 * Calls GOD-Auth-Service's course-note RAG quiz generator
 * (POST /api/quiz/generate/stream) — a separate, already-deployed service
 * that retrieves relevant Bhagavatam course-note chunks and asks an LLM to
 * generate a source-grounded quiz, then independently re-validates every
 * question against its cited passages before returning it (95% confidence
 * floor, reject-and-regenerate on failure). This app does none of that
 * grounding work itself — it only imports the already-validated result.
 *
 * The service generates each question with its own independent model call
 * (bounded concurrency) rather than one call for the whole quiz, and the
 * streaming endpoint reports that as it happens via Server-Sent Events —
 * `progress` events (draft/repairing/validating phases, with
 * completed/total counts during the draft phase), a terminal `complete`
 * event carrying the same payload the non-streaming endpoint returns, a
 * terminal `error` event, and `:heartbeat` comment lines every 15s to keep
 * the connection alive during slow phases. onProgress surfaces `progress`
 * events to the caller; the promise resolves/rejects on `complete`/`error`.
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
import { extractSseFrames, parseSseFrame } from "@/lib/sse";

// The service's own request budget is 90s (see docs/quiz-api.md on
// GOD-Auth-Service) and it heartbeats every 15s while working, so a
// healthy connection always produces *some* frame well within this window.
// This catches a truly dead connection without needing to guess a flat
// ceiling for how long a large, multi-question generation might legitimately
// take — that's the server's budget to enforce, not the client's.
const INACTIVITY_TIMEOUT_MS = 40_000;

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

export type GenerationProgress = {
  phase: "draft" | "repairing" | "validating";
  completed: number;
  total: number;
};

export class QuizGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuizGenerationError";
  }
}

function deriveStreamUrl(generateUrl: string): string {
  return generateUrl.replace(/\/generate\/?$/, "/generate/stream");
}

function toGeneratedQuiz(body: { quiz?: { title?: string; description?: string; questions?: unknown[] } }, promptFallback: string): GeneratedQuiz {
  const questions = (body?.quiz?.questions ?? []).filter(
    (question): question is GeneratedQuestion =>
      typeof question === "object" &&
      question !== null &&
      ((question as { type?: string }).type === "multiple_choice" || (question as { type?: string }).type === "true_false")
  );
  if (questions.length === 0) {
    throw new QuizGenerationError("The generator returned no usable multiple-choice/true-false questions.");
  }
  return {
    title: body.quiz?.title || promptFallback.slice(0, 80),
    description: body.quiz?.description ?? "",
    questions: questions.map((question) => ({
      id: question.id,
      type: question.type,
      question: question.question,
      choices: question.type === "true_false" ? ["True", "False"] : question.choices,
      answer: question.answer,
      explanation: question.explanation ?? "",
    })),
  };
}

export async function generateQuiz(params: {
  prompt: string;
  questionCount: number;
  difficulty: "beginner" | "intermediate" | "advanced" | "mixed";
  topic: string | null;
  coverageLabel: string;
  sourceIds: string[];
  sourceGroups: SourceGroup[];
  onProgress?: (progress: GenerationProgress) => void;
}): Promise<GeneratedQuiz> {
  const apiUrl = process.env.QUIZ_GENERATOR_API_URL;
  if (!apiUrl) throw new QuizGenerationError("QUIZ_GENERATOR_API_URL is not set.");

  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout>;
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), INACTIVITY_TIMEOUT_MS);
  };
  resetIdleTimer();

  try {
    const response = await fetch(deriveStreamUrl(apiUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
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
      signal: controller.signal,
    }).catch((error: unknown) => {
      throw new QuizGenerationError(
        error instanceof Error && error.name === "AbortError"
          ? "Quiz generation stalled — no response from the generator."
          : `Could not reach the quiz generator: ${error instanceof Error ? error.message : String(error)}`
      );
    });

    // Early failures (missing knowledge base, missing API key) come back as
    // a plain JSON error before the response ever upgrades to an event
    // stream — same for anything that isn't actually SSE.
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
      const body = await response.json().catch(() => ({}));
      throw new QuizGenerationError(body.error ?? `Quiz generator returned HTTP ${response.status}.`);
    }
    if (!response.body) {
      throw new QuizGenerationError("Quiz generator returned an empty stream.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdleTimer();
      buffer += decoder.decode(value, { stream: true });

      const { frames, rest } = extractSseFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        const parsed = parseSseFrame(frame);
        if (!parsed) continue; // heartbeat comment

        if (parsed.event === "progress") {
          params.onProgress?.(parsed.data as GenerationProgress);
        } else if (parsed.event === "complete") {
          return toGeneratedQuiz(parsed.data as { quiz?: GeneratedQuiz }, params.prompt);
        } else if (parsed.event === "error") {
          const data = parsed.data as { error?: string };
          throw new QuizGenerationError(data.error ?? "Quiz generation failed.");
        }
      }
    }

    throw new QuizGenerationError("Quiz generator's stream ended without a result.");
  } finally {
    clearTimeout(idleTimer!);
  }
}
