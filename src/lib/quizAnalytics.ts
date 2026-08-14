type QuestionLike = { id: string; question: string };
type ResponseAnswerLike = { questionId: string; correct: boolean };
type ResponseLike = { score: number; totalQuestions: number; answers: unknown };

export type MostMissedQuestion = {
  questionId: string;
  question: string;
  missCount: number;
  missPct: number;
};

export type ResponseSummary = {
  responseCount: number;
  /** null when there are no responses yet. */
  averageScorePct: number | null;
  /** Sorted worst-first; only questions with at least one miss. */
  mostMissed: MostMissedQuestion[];
};

/** Aggregates a self-paced quiz's QuizResponse rows for the host scores page. */
export function summarizeResponses(questions: QuestionLike[], responses: ResponseLike[]): ResponseSummary {
  const responseCount = responses.length;
  if (responseCount === 0) {
    return { responseCount: 0, averageScorePct: null, mostMissed: [] };
  }

  const averageScorePct =
    (responses.reduce((sum, r) => sum + (r.totalQuestions > 0 ? r.score / r.totalQuestions : 0), 0) /
      responseCount) *
    100;

  const missCounts = new Map<string, number>();
  for (const response of responses) {
    const answers = Array.isArray(response.answers) ? (response.answers as ResponseAnswerLike[]) : [];
    for (const answer of answers) {
      if (!answer.correct) {
        missCounts.set(answer.questionId, (missCounts.get(answer.questionId) ?? 0) + 1);
      }
    }
  }

  const mostMissed = questions
    .map((question) => ({
      questionId: question.id,
      question: question.question,
      missCount: missCounts.get(question.id) ?? 0,
      missPct: ((missCounts.get(question.id) ?? 0) / responseCount) * 100,
    }))
    .filter((entry) => entry.missCount > 0)
    .sort((a, b) => b.missCount - a.missCount);

  return { responseCount, averageScorePct, mostMissed };
}
