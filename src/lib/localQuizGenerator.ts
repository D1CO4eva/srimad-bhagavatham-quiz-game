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
 * faithfulness or a duplicate, told so) -> fallback model. The faithfulness
 * judge is always the *other* model from whichever one drafted the
 * candidate, so a model never grades its own output. A second pass
 * re-attempts only the slots still missing after the first full pass.
 * Restricted to multiple_choice/true_false — the only types the live tap
 * UI can render (see Answer model's comment in schema.prisma).
 *
 * Duplicate detection (findDuplicate) catches questions that reuse the same
 * fact even when reworded — e.g. two differently-phrased questions that
 * both boil down to "what is Ashraya" with the same four answer choices
 * just reordered. Word-overlap on the question text alone misses this (the
 * wording can differ a lot); what's actually diagnostic for multiple-choice
 * is a shared answer *plus* overlapping choice sets, since a course with a
 * fixed technical vocabulary (e.g. the ten characteristics of a Purana)
 * will legitimately reuse individual terms as distractors across genuinely
 * different questions — it's reusing the same answer with mostly the same
 * options that signals "this is the same question again," not just
 * touching the same topic. Checked per-slot against everything generated
 * so far, and swept again at the end since bounded concurrency lets two
 * slots pass their own check against the same stale snapshot at once.
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
const DUPLICATE_OVERLAP_THRESHOLD = 0.5;
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
type FailureReason = "invalid_json" | "low_faithfulness" | "duplicate";

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

function normalizeWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** See the module docstring for why this checks answer+choices, not just question-text similarity. */
function findDuplicate(candidate: GeneratedQuestion, existing: GeneratedQuestion[]): GeneratedQuestion | null {
  const candidateQuestionWords = normalizeWords(candidate.question);
  for (const other of existing) {
    if (jaccard(candidateQuestionWords, normalizeWords(other.question)) >= DUPLICATE_OVERLAP_THRESHOLD) {
      return other;
    }
    if (candidate.type === "multiple_choice" && other.type === "multiple_choice") {
      const sameAnswer = candidate.answer.trim().toLowerCase() === other.answer.trim().toLowerCase();
      const choiceOverlap = jaccard(normalizeWords(candidate.choices.join(" ")), normalizeWords(other.choices.join(" ")));
      if (sameAnswer && choiceOverlap >= DUPLICATE_OVERLAP_THRESHOLD) return other;
    }
  }
  return null;
}

function clampSourceText(sourceText: string): string {
  if (sourceText.length <= MAX_SOURCE_TEXT_CHARS) return sourceText;
  return sourceText.slice(0, MAX_SOURCE_TEXT_CHARS) + "\n\n[...source truncated...]";
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
  avoidEntries: GeneratedQuestion[];
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

  if (params.avoidEntries.length > 0) {
    lines.push(
      "Do not test the same underlying fact, reuse the same correct answer, or reuse the same answer " +
        "choices (even reordered) as any of these already-used questions — pick a different specific " +
        "detail or aspect instead, even if it's the same general topic:",
      ...params.avoidEntries.map((q) =>
        q.type === "multiple_choice"
          ? `- "${q.question}" — choices: ${q.choices.join(" / ")}; answer: ${q.answer}`
          : `- "${q.question}" — answer: ${q.answer}`
      )
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

type AttemptResult =
  | { ok: true; question: GeneratedQuestion }
  | { ok: false; reason: FailureReason; raw: string | null; duplicateOf?: string };

async function attemptDraft(params: {
  model: string;
  judgeModel: string;
  messages: ChatMessage[];
  type: QuestionType;
  sourceText: string;
  avoidEntries: GeneratedQuestion[];
}): Promise<AttemptResult> {
  const raw = await tryComplete(params.model, params.messages);
  if (!raw) return { ok: false, reason: "invalid_json", raw: null };

  const parsed = parseDraft(raw, params.type);
  if (!parsed) return { ok: false, reason: "invalid_json", raw };

  const duplicate = findDuplicate(parsed, params.avoidEntries);
  if (duplicate) {
    return { ok: false, reason: "duplicate", raw, duplicateOf: duplicate.question };
  }

  const claim = `Question: ${parsed.question}\nAnswer: ${parsed.answer}\nExplanation: ${parsed.explanation}`;
  const faithfulness = await scoreFaithfulness(claim, params.sourceText, params.judgeModel);
  if (faithfulness !== null && faithfulness < FAITHFULNESS_THRESHOLD) {
    return { ok: false, reason: "low_faithfulness", raw };
  }

  return { ok: true, question: parsed };
}

function repairPrompt(reason: FailureReason, raw: string, duplicateOf?: string): string {
  if (reason === "invalid_json") {
    return (
      `That response was not valid JSON matching the requested shape. Here is what you sent:\n${raw}\n\n` +
      "Respond again with ONLY a corrected JSON object matching the shape above."
    );
  }
  if (reason === "duplicate") {
    return (
      `Here is what you sent:\n${raw}\n\n` +
      `That overlaps too much with an already-used question${duplicateOf ? ` ("${duplicateOf}")` : ""} — the ` +
      "same underlying fact, the same correct answer, or nearly the same answer choices. Pick a different " +
      "specific detail, term, or angle instead — it can be the same general topic, but must test something " +
      "genuinely different. Respond again with ONLY the corrected JSON object."
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
  avoidEntries: GeneratedQuestion[];
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
        avoidEntries: params.avoidEntries,
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
    avoidEntries: params.avoidEntries,
  });
  if (first.ok) return first.question;

  if (first.raw) {
    const repairMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: repairPrompt(first.reason, first.raw, first.duplicateOf) },
    ];
    const second = await attemptDraft({
      model: params.primaryModel,
      judgeModel: params.fallbackModel,
      messages: repairMessages,
      type,
      sourceText: params.sourceText,
      avoidEntries: params.avoidEntries,
    });
    if (second.ok) return second.question;
  }

  const third = await attemptDraft({
    model: params.fallbackModel,
    judgeModel: params.primaryModel,
    messages,
    type,
    sourceText: params.sourceText,
    avoidEntries: params.avoidEntries,
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
}): Promise<GeneratedQuiz> {
  const primaryModel = process.env.OPENROUTER_MODEL_PRIMARY || DEFAULT_PRIMARY_MODEL;
  const fallbackModel = process.env.OPENROUTER_MODEL_FALLBACK || DEFAULT_FALLBACK_MODEL;
  const sourceText = clampSourceText(params.sourceText);

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
        const avoidEntries = slots.filter((q): q is GeneratedQuestion => q !== null);
        slots[slotIndex] = await generateSlot({
          topics: params.topics,
          focusTopic: focusTopicFor(slotIndex),
          coverageLabel: params.coverageLabel,
          difficulty: params.difficulty,
          avoidEntries,
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

  // Bounded concurrency means two slots can each pass their own duplicate
  // check against the same not-yet-updated snapshot before either result is
  // recorded, letting a duplicate through the per-slot ladder above. Sweep
  // the finished slots in order and regenerate any later one that
  // duplicates an earlier one, now against the complete set.
  const acceptedSoFar: GeneratedQuestion[] = [];
  const duplicateIndices: number[] = [];
  slots.forEach((question, index) => {
    if (!question) return;
    if (findDuplicate(question, acceptedSoFar)) {
      duplicateIndices.push(index);
    } else {
      acceptedSoFar.push(question);
    }
  });
  if (duplicateIndices.length > 0) {
    for (const index of duplicateIndices) slots[index] = null;
    completedCount = params.questionCount - duplicateIndices.length;
    await runPass(duplicateIndices, "repairing");
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
