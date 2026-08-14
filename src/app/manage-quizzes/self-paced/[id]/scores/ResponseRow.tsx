"use client";

import { useState } from "react";

type AnswerBreakdown = {
  questionId: string;
  question: string;
  choices: string[];
  correctChoices: string[];
  selectedChoices: string[];
  correct: boolean;
  explanation: string;
};

export function ResponseRow({
  response,
}: {
  response: {
    id: string;
    respondentName: string;
    respondentEmail: string;
    respondentPhone: string;
    respondentCountryCode: string;
    respondentRegNo: string;
    score: number;
    totalQuestions: number;
    answers: unknown;
    submittedAt: Date;
  };
}) {
  const [expanded, setExpanded] = useState(false);
  const answers = Array.isArray(response.answers) ? (response.answers as AnswerBreakdown[]) : [];
  const pct = response.totalQuestions > 0 ? Math.round((response.score / response.totalQuestions) * 100) : 0;

  return (
    <li className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">{response.respondentName}</p>
          <p className="text-sm text-ink-soft">
            {response.respondentRegNo} · {response.respondentEmail} · {response.respondentCountryCode}
            {response.respondentPhone}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-lg font-bold text-brand-ink">
            {response.score}/{response.totalQuestions} ({pct}%)
          </p>
          <button type="button" onClick={() => setExpanded((v) => !v)} className="btn btn-secondary">
            {expanded ? "Hide" : "View Full Quiz"}
          </button>
        </div>
      </div>
      <p className="text-xs text-ink-soft">Submitted {response.submittedAt.toLocaleString()}</p>

      {expanded && (
        <ol className="flex flex-col gap-3 border-t border-line pt-3">
          {answers.map((answer, index) => (
            <li key={answer.questionId} className="rounded-2xl border border-line p-4 text-sm">
              <p className="font-semibold text-ink">
                {index + 1}. {answer.question}
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {answer.choices.map((choice) => {
                  const wasSelected = answer.selectedChoices.includes(choice);
                  const isCorrectChoice = answer.correctChoices.includes(choice);
                  return (
                    <li
                      key={choice}
                      className={
                        isCorrectChoice
                          ? "font-semibold text-success"
                          : wasSelected
                            ? "font-semibold text-danger"
                            : "text-ink-soft"
                      }
                    >
                      {choice}
                      {wasSelected ? " (their answer)" : ""}
                    </li>
                  );
                })}
              </ul>
              <p className={`mt-2 text-xs font-bold ${answer.correct ? "text-success" : "text-danger"}`}>
                {answer.correct ? "Correct" : "Incorrect"}
              </p>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
