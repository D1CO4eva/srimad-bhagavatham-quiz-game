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

// checkAnswerable() reuses completeChat (same mock as drafting calls) rather
// than a separate module like faithfulness, so tests distinguish it by the
// one phrase only its own prompt contains.
function isAnswerabilityCheck(messages: ChatMessage[]): boolean {
  return (messages.find((m) => m.role === "user")?.content ?? "").includes("Marked correct answer:");
}

// Each call cycles through genuinely distinct facts (not just a numeric
// suffix — normalizeWords drops words of length <= 3, including bare
// digits, so e.g. "chapter 1" vs "chapter 2" would normalize to identical
// word sets and falsely trip duplicate detection) so tests that aren't
// about duplicate detection don't accidentally trigger it.
const MULTIPLE_CHOICE_FACTS = [
  { question: "Who narrates the Bhagavatam to Pariksit?", choices: ["Sukadeva Goswami", "Vyasa", "Narada", "Suta"], answer: "Sukadeva Goswami" },
  { question: "Which sage compiled the Vedas into four divisions?", choices: ["Vyasa", "Valmiki", "Narada", "Suta"], answer: "Vyasa" },
  { question: "Who is described as the son of Vyasa in the Bhagavatam?", choices: ["Sukadeva", "Arjuna", "Yudhishthira", "Bhima"], answer: "Sukadeva" },
  { question: "Which king heard the Bhagavatam before his death?", choices: ["Pariksit", "Yudhishthira", "Dhritarashtra", "Duryodhana"], answer: "Pariksit" },
  { question: "Whose curse led to Pariksit's seven-day deadline?", choices: ["Shringi", "Shukadeva", "Vyasa", "Narada"], answer: "Shringi" },
];
const TRUE_FALSE_FACTS = [
  "Krishna appears within the events narrated in the Bhagavatam's tenth canto.",
  "The Srimad Bhagavatam is traditionally divided into twelve cantos.",
  "Vyasa is credited with compiling the Mahabharata.",
  "Pariksit was cursed by the son of a brahmana sage.",
  "Sukadeva Goswami is described as a renunciate from birth.",
];
let draftCounter = 0;
function validDraftFor(messages: ChatMessage[]): string {
  // checkAnswerable() also goes through completeChat — default it to a
  // benign pass so tests that aren't specifically about answerability don't
  // need to think about it, and (just as importantly) so it doesn't consume
  // a draftCounter tick and throw off which fact each real draft call gets.
  if (isAnswerabilityCheck(messages)) {
    return JSON.stringify({ answerable: true, reason: "fine" });
  }
  const index = draftCounter++ % MULTIPLE_CHOICE_FACTS.length;
  if (requestedType(messages) === "true_false") {
    return JSON.stringify({ type: "true_false", question: TRUE_FALSE_FACTS[index], answer: "True", explanation: "Because." });
  }
  return JSON.stringify({ type: "multiple_choice", ...MULTIPLE_CHOICE_FACTS[index], explanation: "Because." });
}

describe("generateQuiz", () => {
  const originalFallback = process.env.OPENROUTER_MODEL_FALLBACK;

  beforeEach(() => {
    draftCounter = 0;
    // Default: faithfulness check passes (or is skipped, same as an empty
    // sourceText would do for real) so tests that aren't about grounding
    // don't need to think about it.
    scoreFaithfulnessMock.mockImplementation(async () => null);
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

  it("never keeps two questions that are exact repeats of each other", async () => {
    // Every call returns the exact same multiple_choice content — with two
    // slots running concurrently, both can pass their own duplicate check
    // before either result is recorded (the scenario the final sweep pass
    // exists to catch), and every regeneration attempt is just as
    // duplicate, so the second slot should end up dropped rather than kept.
    completeChatMock.mockImplementation(async () =>
      JSON.stringify({
        type: "multiple_choice",
        question: "What is the main subject that Srimad Bhagavatam directs us towards?",
        choices: ["Mukti", "Ashraya", "Sarga", "Poshanam"],
        answer: "Ashraya",
        explanation: "Because.",
      })
    );

    const { generateQuiz } = await import("@/lib/localQuizGenerator");
    const quiz = await generateQuiz({
      topics: ["Sanatana Dharma"],
      sourceText: "",
      questionCount: 2,
      difficulty: "mixed",
      coverageLabel: "Week 1",
    });

    expect(quiz.questions).toHaveLength(1);
  });

  it("rejects a reworded question that reuses the same answer and mostly the same choices", async () => {
    // Reproduces the reported bug: differently-worded questions that both
    // resolve to the same answer with 3 of 4 choices in common (only their
    // wording differs, e.g. "main subject Bhagavatam directs us towards"
    // vs. "main subject (lakshana) of Canto 10") should be caught even
    // though plain question-text similarity wouldn't flag them.
    let call = 0;
    completeChatMock.mockImplementation(async () => {
      call++;
      return call % 2 === 1
        ? JSON.stringify({
            type: "multiple_choice",
            question: "What is the main subject that Srimad Bhagavatam directs us towards?",
            choices: ["Mukti", "Ashraya", "Sarga", "Poshanam"],
            answer: "Ashraya",
            explanation: "Because.",
          })
        : JSON.stringify({
            type: "multiple_choice",
            question: "What is the main subject (lakshana) of Canto 10 in Srimad Bhagavatam?",
            choices: ["Ashraya", "Sarga", "Visarga", "Mukti"],
            answer: "Ashraya",
            explanation: "Because.",
          });
    });

    const { generateQuiz } = await import("@/lib/localQuizGenerator");
    const quiz = await generateQuiz({
      topics: ["Sanatana Dharma"],
      sourceText: "",
      questionCount: 2,
      difficulty: "mixed",
      coverageLabel: "Week 1",
    });

    expect(quiz.questions).toHaveLength(1);
  });

  it("rejects an ambiguous multiple_choice draft and recovers once the answerability check passes", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0); // forces multiple_choice every time
    let answerabilityCalls = 0;
    completeChatMock.mockImplementation(async (_model: string, messages: ChatMessage[]) => {
      if (isAnswerabilityCheck(messages)) {
        answerabilityCalls++;
        return JSON.stringify({ answerable: answerabilityCalls > 1, reason: "test" });
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
    expect(quiz.questions[0].type).toBe("multiple_choice");
    expect(answerabilityCalls).toBeGreaterThan(1);
    randomSpy.mockRestore();
  });

  it("drops a multiple_choice slot whose answerability check never passes", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0); // forces multiple_choice every time
    completeChatMock.mockImplementation(async (_model: string, messages: ChatMessage[]) => {
      if (isAnswerabilityCheck(messages)) {
        return JSON.stringify({ answerable: false, reason: "always ambiguous" });
      }
      return validDraftFor(messages);
    });

    const { generateQuiz, QuizGenerationError } = await import("@/lib/localQuizGenerator");
    await expect(
      generateQuiz({
        topics: ["Sanatana Dharma"],
        sourceText: "",
        questionCount: 1,
        difficulty: "mixed",
        coverageLabel: "Week 1",
      })
    ).rejects.toThrow(QuizGenerationError);
    randomSpy.mockRestore();
  });
});
