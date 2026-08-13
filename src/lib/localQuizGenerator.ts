/**
 * Generates Bhagavatam class quiz questions in-house via OpenRouter, one
 * question at a time (bounded concurrency), instead of calling out to an
 * external RAG service. Grounded in the actual course-note text for the
 * selected week(s) (src/lib/courseCatalog.ts's getSourceText(), backed by
 * src/data/courseNotes.json) rather than the model's own general knowledge
 * — the source excerpt is included directly in every generation prompt
 * (the whole corpus is small enough that no chunking/retrieval is needed),
 * and each candidate is checked with autoevals' Faithfulness metric
 * (src/lib/faithfulness.ts) before being accepted.
 *
 * Each question slot gets its own model call so one bad response only costs
 * a single question, with a retry ladder per slot: primary model -> repair
 * retry (same model, shown its own bad output and, if the failure was low
 * faithfulness, told so) -> fallback model. The faithfulness judge is
 * always the *other* model from whichever one drafted the candidate, so a
 * model never grades its own output. A second pass re-attempts only the
 * slots still missing after the first full pass. Restricted to
 * multiple_choice/true_false — the only types the live tap UI can render
 * (see Answer model's comment in schema.prisma).
 */

import { nanoid } from "nanoid";
import { z } from "zod";
import { completeChat, type ChatMessage } from "@/lib/openrouter";
import { scoreFaithfulness } from "@/lib/faithfulness";

const DEFAULT_PRIMARY_MODEL = "openai/gpt-4o-mini";
const DEFAULT_FALLBACK_MODEL = "google/gemini-2.5-flash";
const CONCURRENCY = 4;
const MULTIPLE_CHOICE_RATIO = 0.75;
const FAITHFULNESS_THRESHOLD = 0.7;
// Token-overlap (Jaccard) similarity above which a candidate is treated as
// testing the same underlying fact as an already-used question, even if
// reworded — catches near-duplicates the LLM's own "avoid list" instruction
// misses or ignores.
const DUPLICATE_SIMILARITY_THRESHOLD = 0.6;
// Cap on how many avoid-list entries get spelled out in the prompt text
// itself — the programmatic near-duplicate check below still compares
// against the full list regardless of this cap, since that's free (no
// extra tokens), only the prompt text needs bounding.
const MAX_AVOID_QUESTIONS_IN_PROMPT = 25;
// The whole course-notes corpus is ~70KB (see src/data/courseNotes.json) —
// comfortably under this even if a host selects every week at once. This is
// a safety cap against a much larger future corpus, not a normal-path limit.
const MAX_SOURCE_TEXT_CHARS = 60_000;

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

type Difficulty = "beginner" | "intermediate" | "advanced" | "mixed";
type EffectiveDifficulty = "beginner" | "intermediate" | "advanced";
type QuestionType = "multiple_choice" | "true_false";
type FailureReason = "invalid_json" | "low_faithfulness" | "near_duplicate";

const DIFFICULTY_GUIDANCE: Record<EffectiveDifficulty, string> = {
  beginner: "a straightforward recall question testing a clearly stated fact from the topic",
  intermediate: "a question that asks the student to connect two related ideas or explain significance, not just recall an isolated fact",
  advanced: "a challenging, reflective question probing deeper meaning, context, or application — not answerable from a single isolated fact",
};

function pickEffectiveDifficulty(difficulty: Difficulty): EffectiveDifficulty {
  if (difficulty !== "mixed") return difficulty;
  const pool: EffectiveDifficulty[] = ["beginner", "intermediate", "advanced"];
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickQuestionType(): QuestionType {
  return Math.random() < MULTIPLE_CHOICE_RATIO ? "multiple_choice" : "true_false";
}

function clampSourceText(sourceText: string): string {
  if (sourceText.length <= MAX_SOURCE_TEXT_CHARS) return sourceText;
  return sourceText.slice(0, MAX_SOURCE_TEXT_CHARS) + "\n\n[...source truncated...]";
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Catches "same fact, different wording" duplicates programmatically —
 * the avoid-list prompt instruction is advisory only and the model doesn't
 * always follow it, especially across separately-generated quizzes covering
 * the same source material.
 */
export function isNearDuplicate(question: string, avoidQuestions: string[]): boolean {
  const tokens = tokenize(question);
  return avoidQuestions.some((existing) => jaccardSimilarity(tokens, tokenize(existing)) >= DUPLICATE_SIMILARITY_THRESHOLD);
}

function buildSystemPrompt(grounded: boolean): string {
  const base =
    "You are an expert instructor for a home-study course on the Srimad Bhagavatam, a classical " +
    "Sanskrit Vaishnava scripture organized into Cantos. Write exactly one quiz question for " +
    "students reviewing the course material. Respond with a single strict JSON object only — no " +
    "markdown code fences, no commentary before or after it.";
  if (!grounded) {
    return `${base} Draw on your own knowledge of the Srimad Bhagavatam's content, stories, and teachings.`;
  }
  return (
    `${base} Base every claim in the question, answer, and explanation strictly on the course-note ` +
    "excerpt provided below — do not introduce facts, names, or details that aren't present in it, " +
    "even if they're true of the Srimad Bhagavatam in general."
  );
}

function buildUserPrompt(params: {
  topics: string[];
  focusTopic: string | null;
  coverageLabel: string;
  type: QuestionType;
  effectiveDifficulty: EffectiveDifficulty;
  avoidQuestions: string[];
  sourceText: string;
}): string {
  const topicList = params.topics.length > 0 ? params.topics.join("; ") : params.coverageLabel;
  const lines: string[] = [];

  if (params.sourceText.trim()) {
    lines.push(
      "Course-note excerpt (this is your only source — do not use outside knowledge beyond what's written here):",
      '"""',
      params.sourceText.trim(),
      '"""',
      ""
    );
  }

  lines.push(
    `Course coverage: ${params.coverageLabel || topicList}.`,
    params.focusTopic
      ? `Focus this question specifically on: ${params.focusTopic}. (Full topic list for context: ${topicList}.)`
      : `Topics to draw from: ${topicList}.`,
    params.type === "multiple_choice"
      ? `Write ${DIFFICULTY_GUIDANCE[params.effectiveDifficulty]}.`
      : `Write ${DIFFICULTY_GUIDANCE[params.effectiveDifficulty]}, phrased as a true/false statement.`
  );

  if (params.avoidQuestions.length > 0) {
    lines.push(
      "Do not test the same underlying fact or claim as any of these already-used questions, even if reworded:",
      ...params.avoidQuestions.slice(0, MAX_AVOID_QUESTIONS_IN_PROMPT).map((q) => `- ${q}`)
    );
  }

  lines.push("Return JSON matching exactly this shape:");
  lines.push(
    params.type === "multiple_choice"
      ? '{"type":"multiple_choice","question":"...","choices":["...","...","...","..."],"answer":"<one of the four choices, verbatim>","explanation":"..."}'
      : '{"type":"true_false","question":"...","answer":"True" or "False","explanation":"..."}'
  );
  if (params.type === "multiple_choice") {
    lines.push(
      'Exactly 4 choices, only one correct, choices in a random order, and "answer" must match one of the choices character-for-character.'
    );
  }

  return lines.join("\n");
}

const MultipleChoiceDraftSchema = z
  .object({
    type: z.literal("multiple_choice"),
    question: z.string().trim().min(1),
    choices: z.array(z.string().trim().min(1)).length(4),
    answer: z.string().trim().min(1),
    explanation: z.string().trim().min(1),
  })
  .refine((draft) => draft.choices.includes(draft.answer), {
    message: "answer must match one of the choices exactly",
  });

const TrueFalseDraftSchema = z.object({
  type: z.literal("true_false"),
  question: z.string().trim().min(1),
  answer: z.enum(["True", "False"]),
  explanation: z.string().trim().min(1),
});

function parseDraft(raw: string, type: QuestionType): GeneratedQuestion | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }

  if (type === "multiple_choice") {
    const result = MultipleChoiceDraftSchema.safeParse(json);
    if (!result.success) return null;
    return {
      id: nanoid(),
      type: "multiple_choice",
      question: result.data.question,
      choices: result.data.choices,
      answer: result.data.answer,
      explanation: result.data.explanation,
    };
  }

  const result = TrueFalseDraftSchema.safeParse(json);
  if (!result.success) return null;
  return {
    id: nanoid(),
    type: "true_false",
    question: result.data.question,
    choices: ["True", "False"],
    answer: result.data.answer,
    explanation: result.data.explanation,
  };
}

async function tryComplete(model: string, messages: ChatMessage[]): Promise<string | null> {
  try {
    return await completeChat(model, messages);
  } catch {
    return null;
  }
}

type AttemptResult = { ok: true; question: GeneratedQuestion } | { ok: false; reason: FailureReason; raw: string | null };

async function attemptDraft(params: {
  model: string;
  judgeModel: string;
  messages: ChatMessage[];
  type: QuestionType;
  sourceText: string;
  avoidQuestions: string[];
}): Promise<AttemptResult> {
  const raw = await tryComplete(params.model, params.messages);
  if (!raw) return { ok: false, reason: "invalid_json", raw: null };

  const parsed = parseDraft(raw, params.type);
  if (!parsed) return { ok: false, reason: "invalid_json", raw };

  if (isNearDuplicate(parsed.question, params.avoidQuestions)) {
    return { ok: false, reason: "near_duplicate", raw };
  }

  const claim = `Question: ${parsed.question}\nAnswer: ${parsed.answer}\nExplanation: ${parsed.explanation}`;
  const faithfulness = await scoreFaithfulness(claim, params.sourceText, params.judgeModel);
  if (faithfulness !== null && faithfulness < FAITHFULNESS_THRESHOLD) {
    return { ok: false, reason: "low_faithfulness", raw };
  }

  return { ok: true, question: parsed };
}

function repairPrompt(reason: FailureReason, raw: string): string {
  if (reason === "invalid_json") {
    return (
      `That response was not valid JSON matching the requested shape. Here is what you sent:\n${raw}\n\n` +
      "Respond again with ONLY a corrected JSON object matching the shape above."
    );
  }
  if (reason === "near_duplicate") {
    return (
      `Here is what you sent:\n${raw}\n\n` +
      "That question tests essentially the same underlying fact as one already used, just reworded or " +
      "reformatted (e.g. asking for the same count/name/date in different phrasing). Write a question " +
      "about a clearly different fact or claim from the course-note excerpt. Respond again with ONLY the " +
      "corrected JSON object."
    );
  }
  return (
    `Here is what you sent:\n${raw}\n\n` +
    "That question, answer, or explanation wasn't clearly supported by the course-note excerpt above — " +
    "it may be relying on outside knowledge instead of what's actually written there. Revise it so every " +
    "claim is directly grounded in the excerpt. Respond again with ONLY the corrected JSON object."
  );
}

async function generateSlot(params: {
  topics: string[];
  focusTopic: string | null;
  coverageLabel: string;
  difficulty: Difficulty;
  avoidQuestions: string[];
  sourceText: string;
  primaryModel: string;
  fallbackModel: string;
}): Promise<GeneratedQuestion | null> {
  const type = pickQuestionType();
  const effectiveDifficulty = pickEffectiveDifficulty(params.difficulty);
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(params.sourceText.trim().length > 0) },
    {
      role: "user",
      content: buildUserPrompt({
        topics: params.topics,
        focusTopic: params.focusTopic,
        coverageLabel: params.coverageLabel,
        type,
        effectiveDifficulty,
        avoidQuestions: params.avoidQuestions,
        sourceText: params.sourceText,
      }),
    },
  ];

  const first = await attemptDraft({
    model: params.primaryModel,
    judgeModel: params.fallbackModel,
    messages,
    type,
    sourceText: params.sourceText,
    avoidQuestions: params.avoidQuestions,
  });
  if (first.ok) return first.question;

  if (first.raw) {
    const repairMessages: ChatMessage[] = [...messages, { role: "user", content: repairPrompt(first.reason, first.raw) }];
    const second = await attemptDraft({
      model: params.primaryModel,
      judgeModel: params.fallbackModel,
      messages: repairMessages,
      type,
      sourceText: params.sourceText,
      avoidQuestions: params.avoidQuestions,
    });
    if (second.ok) return second.question;
  }

  const third = await attemptDraft({
    model: params.fallbackModel,
    judgeModel: params.primaryModel,
    messages,
    type,
    sourceText: params.sourceText,
    avoidQuestions: params.avoidQuestions,
  });
  return third.ok ? third.question : null;
}

export async function generateQuiz(params: {
  topics: string[];
  sourceText: string;
  questionCount: number;
  difficulty: Difficulty;
  coverageLabel: string;
  onProgress?: (progress: GenerationProgress) => void;
  /** Questions from prior quizzes on this material — seeds the avoid-list
   * beyond just this run's own in-batch questions (Story: generation quality). */
  existingQuestions?: string[];
}): Promise<GeneratedQuiz> {
  const primaryModel = process.env.OPENROUTER_MODEL_PRIMARY || DEFAULT_PRIMARY_MODEL;
  const fallbackModel = process.env.OPENROUTER_MODEL_FALLBACK || DEFAULT_FALLBACK_MODEL;
  const sourceText = clampSourceText(params.sourceText);
  const existingQuestions = params.existingQuestions ?? [];

  // Round-robin a shuffled topic order across slots (rather than handing
  // every call the same full topic list) so questions spread across the
  // material instead of the model gravitating to the same one or two facts
  // repeatedly, especially for short true/false statements.
  const shuffledTopics = [...params.topics].sort(() => Math.random() - 0.5);
  const focusTopicFor = (slotIndex: number): string | null =>
    shuffledTopics.length > 0 ? shuffledTopics[slotIndex % shuffledTopics.length] : null;

  const slots: (GeneratedQuestion | null)[] = new Array(params.questionCount).fill(null);
  let completedCount = 0;

  async function runPass(indices: number[], phase: GenerationProgress["phase"]) {
    let cursor = 0;
    async function worker() {
      while (cursor < indices.length) {
        const slotIndex = indices[cursor++];
        const avoidQuestions = [
          ...existingQuestions,
          ...slots.filter((q): q is GeneratedQuestion => q !== null).map((q) => q.question),
        ];
        slots[slotIndex] = await generateSlot({
          topics: params.topics,
          focusTopic: focusTopicFor(slotIndex),
          coverageLabel: params.coverageLabel,
          difficulty: params.difficulty,
          avoidQuestions,
          sourceText,
          primaryModel,
          fallbackModel,
        });
        completedCount++;
        params.onProgress?.({ phase, completed: completedCount, total: params.questionCount });
      }
    }
    const workerCount = Math.min(CONCURRENCY, indices.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
  }

  completedCount = 0;
  await runPass(
    slots.map((_, i) => i),
    "draft"
  );

  const missingIndices = slots.reduce<number[]>((acc, q, i) => (q === null ? [...acc, i] : acc), []);
  if (missingIndices.length > 0) {
    completedCount = params.questionCount - missingIndices.length;
    await runPass(missingIndices, "repairing");
  }

  const questions = slots.filter((q): q is GeneratedQuestion => q !== null);
  if (questions.length === 0) {
    throw new QuizGenerationError("The generator could not produce any usable questions. Try again.");
  }

  const title = params.coverageLabel ? `${params.coverageLabel} Quiz` : "Bhagavatam Quiz";
  const description =
    params.topics.length > 0
      ? `Covering ${params.topics.slice(0, 3).join(", ")}${params.topics.length > 3 ? ", and more" : ""}.`
      : "";

  return { title, description, questions };
}
