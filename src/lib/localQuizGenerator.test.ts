import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/openrouter";

const completeChatMock = vi.fn();
const scoreFaithfulnessMock = vi.fn();

vi.mock("@/lib/openrouter", () => ({
  completeChat: (...args: [string, ChatMessage[]]) => completeChatMock(...args),
  OpenRouterError: class OpenRouterError extends Error {},
}));

vi.mock("@/lib/faithfulness", () => ({
  scoreFaithfulness: (...args: [string, string, string]) => scoreFaithfulnessMock(...args),
}));

function requestedType(messages: ChatMessage[]): "multiple_choice" | "true_false" {
  const userContent = messages.find((m) => m.role === "user")?.content ?? "";
  return userContent.includes('"type":"true_false"') ? "true_false" : "multiple_choice";
}

// Distinct, non-duplicate content per call (rather than one fixed string
// reused everywhere) so tests exercise multiple slots without tripping the
// generator's own near-duplicate rejection — a pool of 8 per type covers
// every questionCount used below (max 5) even in the worst-case type split.
const MC_QUESTIONS = [
  { question: "Who narrates the Bhagavatam to Pariksit?", choices: ["Sukadeva Goswami", "Vyasa", "Narada", "Suta"], answer: "Sukadeva Goswami" },
  { question: "Who cursed Maharaja Pariksit to die within seven days?", choices: ["Sringi", "Duryodhana", "Kamsa", "Ravana"], answer: "Sringi" },
  { question: "How many cantos does the Bhagavatam have?", choices: ["10", "12", "18", "24"], answer: "12" },
  { question: "Who compiled the Vedas into four divisions?", choices: ["Vyasadeva", "Narada", "Brahma", "Shiva"], answer: "Vyasadeva" },
  { question: "What river does Pariksit sit beside to hear the Bhagavatam?", choices: ["Ganges", "Yamuna", "Sarasvati", "Godavari"], answer: "Ganges" },
  { question: "Who is the speaker of the Bhagavad Gita?", choices: ["Krishna", "Arjuna", "Vyasa", "Sanjaya"], answer: "Krishna" },
  { question: "The Bhagavatam is considered a natural commentary on which text?", choices: ["Vedanta Sutra", "Manu Smriti", "Yoga Sutra", "Upanishads"], answer: "Vedanta Sutra" },
  { question: "Who was Pariksit's grandfather?", choices: ["Arjuna", "Yudhisthira", "Bhima", "Nakula"], answer: "Arjuna" },
];
const TF_QUESTIONS = [
  { question: "Krishna appears in Canto 1?", answer: "True" },
  { question: "Pariksit ruled for one hundred years after the curse?", answer: "False" },
  { question: "Sukadeva Goswami was Vyasadeva's son?", answer: "True" },
  { question: "The Bhagavatam has twenty-four cantos?", answer: "False" },
  { question: "Pariksit heard the Bhagavatam for seven days before his death?", answer: "True" },
  { question: "Narada Muni is the one who cursed Pariksit?", answer: "False" },
  { question: "The Bhagavatam was originally composed in Sanskrit?", answer: "True" },
  { question: "Vyasadeva personally narrated the Bhagavatam to Pariksit?", answer: "False" },
];
let mcIndex = 0;
let tfIndex = 0;

function validDraftFor(messages: ChatMessage[]): string {
  if (requestedType(messages) === "true_false") {
    const q = TF_QUESTIONS[tfIndex++ % TF_QUESTIONS.length];
    return JSON.stringify({ type: "true_false", question: q.question, answer: q.answer, explanation: "Because." });
  }
  const q = MC_QUESTIONS[mcIndex++ % MC_QUESTIONS.length];
  return JSON.stringify({
    type: "multiple_choice",
    question: q.question,
    choices: q.choices,
    answer: q.answer,
    explanation: "Because.",
  });
}

describe("generateQuiz", () => {
  const originalFallback = process.env.OPENROUTER_MODEL_FALLBACK;

  beforeEach(() => {
    // Default: faithfulness check passes (or is skipped, same as an empty
    // sourceText would do for real) so tests that aren't about grounding
    // don't need to think about it.
    scoreFaithfulnessMock.mockImplementation(async () => null);
    mcIndex = 0;
    tfIndex = 0;
  });

  afterEach(() => {
    completeChatMock.mockReset();
    scoreFaithfulnessMock.mockReset();
    if (originalFallback === undefined) delete process.env.OPENROUTER_MODEL_FALLBACK;
    else process.env.OPENROUTER_MODEL_FALLBACK = originalFallback;
  });

  it("generates exactly questionCount questions when every model call succeeds", async () => {
    completeChatMock.mockImplementation(async (_model: string, messages: ChatMessage[]) => validDraftFor(messages));

    const { generateQuiz } = await import("@/lib/localQuizGenerator");
    const quiz = await generateQuiz({
      topics: ["Sanatana Dharma"],
      sourceText: "",
      questionCount: 5,
      difficulty: "mixed",
      coverageLabel: "Week 1",
    });

    expect(quiz.questions).toHaveLength(5);
    for (const question of quiz.questions) {
      if (question.type === "true_false") {
        expect(question.choices).toEqual(["True", "False"]);
      } else {
        expect(question.choices).toContain(question.answer);
      }
    }
  });

  it("reports draft progress up to the full total when nothing needs repairing", async () => {
    completeChatMock.mockImplementation(async (_model: string, messages: ChatMessage[]) => validDraftFor(messages));
    const { generateQuiz } = await import("@/lib/localQuizGenerator");

    const progressEvents: { phase: string; completed: number; total: number }[] = [];
    await generateQuiz({
      topics: ["Sanatana Dharma"],
      sourceText: "",
      questionCount: 3,
      difficulty: "mixed",
      coverageLabel: "Week 1",
      onProgress: (p) => progressEvents.push(p),
    });

    expect(progressEvents).toHaveLength(3);
    expect(progressEvents.every((p) => p.phase === "draft" && p.total === 3)).toBe(true);
    expect(progressEvents[progressEvents.length - 1].completed).toBe(3);
  });

  it("falls back to the second model and still succeeds when the primary model never returns valid JSON", async () => {
    process.env.OPENROUTER_MODEL_FALLBACK = "fallback/model";
    completeChatMock.mockImplementation(async (model: string, messages: ChatMessage[]) => {
      if (model === "fallback/model") return validDraftFor(messages);
      return "not valid json";
    });

    const { generateQuiz } = await import("@/lib/localQuizGenerator");
    const quiz = await generateQuiz({
      topics: ["Sanatana Dharma"],
      sourceText: "",
      questionCount: 3,
      difficulty: "mixed",
      coverageLabel: "Week 1",
    });

    expect(quiz.questions).toHaveLength(3);
    const fallbackCalls = completeChatMock.mock.calls.filter(([model]) => model === "fallback/model");
    expect(fallbackCalls.length).toBeGreaterThan(0);
  });

  it("throws QuizGenerationError when every model call returns invalid JSON", async () => {
    completeChatMock.mockImplementation(async () => "not valid json");

    const { generateQuiz, QuizGenerationError } = await import("@/lib/localQuizGenerator");
    await expect(
      generateQuiz({
        topics: ["Sanatana Dharma"],
        sourceText: "",
        questionCount: 2,
        difficulty: "mixed",
        coverageLabel: "Week 1",
      })
    ).rejects.toThrow(QuizGenerationError);
  });

  it("rejects a malformed first draft (bad answer/choices) and recovers via the repair retry", async () => {
    let calls = 0;
    completeChatMock.mockImplementation(async (_model: string, messages: ChatMessage[]) => {
      calls++;
      if (calls === 1) {
        return requestedType(messages) === "multiple_choice"
          ? JSON.stringify({
              type: "multiple_choice",
              question: "Bad draft",
              choices: ["A", "B", "C", "D"],
              answer: "Not one of the choices",
              explanation: "E",
            })
          : JSON.stringify({ type: "true_false", question: "Bad draft", answer: "Maybe", explanation: "E" });
      }
      return validDraftFor(messages);
    });

    const { generateQuiz } = await import("@/lib/localQuizGenerator");
    const quiz = await generateQuiz({
      topics: ["Sanatana Dharma"],
      sourceText: "",
      questionCount: 1,
      difficulty: "mixed",
      coverageLabel: "Week 1",
    });

    expect(quiz.questions).toHaveLength(1);
    expect(quiz.questions[0].choices).toContain(quiz.questions[0].answer);
  });

  it("retries a schema-valid draft that fails the faithfulness check, and keeps it once faithfulness passes", async () => {
    completeChatMock.mockImplementation(async (_model: string, messages: ChatMessage[]) => validDraftFor(messages));
    scoreFaithfulnessMock
      .mockImplementationOnce(async () => 0.2) // first attempt: not grounded
      .mockImplementation(async () => 0.95); // repair retry: grounded

    const { generateQuiz } = await import("@/lib/localQuizGenerator");
    const quiz = await generateQuiz({
      topics: ["Sanatana Dharma"],
      sourceText: "Some course-note excerpt.",
      questionCount: 1,
      difficulty: "mixed",
      coverageLabel: "Week 1",
    });

    expect(quiz.questions).toHaveLength(1);
    expect(scoreFaithfulnessMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("drops a slot whose drafts never pass the faithfulness check", async () => {
    completeChatMock.mockImplementation(async (_model: string, messages: ChatMessage[]) => validDraftFor(messages));
    scoreFaithfulnessMock.mockImplementation(async () => 0.1);

    const { generateQuiz, QuizGenerationError } = await import("@/lib/localQuizGenerator");
    await expect(
      generateQuiz({
        topics: ["Sanatana Dharma"],
        sourceText: "Some course-note excerpt.",
        questionCount: 1,
        difficulty: "mixed",
        coverageLabel: "Week 1",
      })
    ).rejects.toThrow(QuizGenerationError);
  });

  it("seeds the avoid-list with existingQuestions passed in from the caller", async () => {
    // Every draft this mock produces matches an "existing" question exactly
    // (reworded slightly doesn't matter here — same text), so every attempt
    // across all three tries should be rejected as a near-duplicate and the
    // slot should be dropped rather than accepted.
    completeChatMock.mockImplementation(async () =>
      JSON.stringify({
        type: "true_false",
        question: "Krishna appears in Canto 1?",
        answer: "True",
        explanation: "Because.",
      })
    );

    const { generateQuiz, QuizGenerationError } = await import("@/lib/localQuizGenerator");
    await expect(
      generateQuiz({
        topics: ["Sanatana Dharma"],
        sourceText: "",
        questionCount: 1,
        difficulty: "mixed",
        coverageLabel: "Week 1",
        existingQuestions: ["Krishna appears in Canto 1?"],
      })
    ).rejects.toThrow(QuizGenerationError);
  });
});

describe("isNearDuplicate", () => {
  it("flags an exact repeat", async () => {
    const { isNearDuplicate } = await import("@/lib/localQuizGenerator");
    expect(isNearDuplicate("How many cantos does the Bhagavatam have?", ["How many cantos does the Bhagavatam have?"])).toBe(
      true
    );
  });

  it("flags a reworded near-duplicate asking the same underlying fact", async () => {
    const { isNearDuplicate } = await import("@/lib/localQuizGenerator");
    expect(
      isNearDuplicate("How many cantos does the Srimad Bhagavatam have in total?", [
        "How many cantos does the Bhagavatam have?",
      ])
    ).toBe(true);
  });

  it("does not flag a genuinely different question", async () => {
    const { isNearDuplicate } = await import("@/lib/localQuizGenerator");
    expect(
      isNearDuplicate("Who narrated the Bhagavatam to Maharaja Parikshit?", ["How many cantos does the Bhagavatam have?"])
    ).toBe(false);
  });

  it("is false against an empty avoid-list", async () => {
    const { isNearDuplicate } = await import("@/lib/localQuizGenerator");
    expect(isNearDuplicate("Any question at all?", [])).toBe(false);
  });
});
