"use client";

import { useEffect, useState } from "react";
import { getQuizResponseId, saveQuizResponseId } from "@/lib/quizResponseSession";
import { COUNTRY_CODES } from "@/lib/countryCodes";

type Question = {
  id: string;
  order: number;
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER" | "MULTI_SELECT";
  question: string;
  choices: string[];
};

type AnswerBreakdown = {
  questionId: string;
  order: number;
  question: string;
  choices: string[];
  correctChoices: string[];
  selectedChoices: string[];
  correct: boolean;
  explanation: string;
};

type SubmitResult = { responseId: string; score: number; totalQuestions: number; answers: AnswerBreakdown[] };

export function TakeQuizForm({
  slug,
  title,
  description,
  questions,
}: {
  slug: string;
  title: string;
  description: string;
  questions: Question[];
}) {
  const [priorResponseId] = useState(() => (typeof window !== "undefined" ? getQuizResponseId(slug) : null));
  const [checkingPriorResponse, setCheckingPriorResponse] = useState(Boolean(priorResponseId));
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [viewFull, setViewFull] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!priorResponseId) return;
    fetch(`/api/quiz/${slug}/my-response?responseId=${priorResponseId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data) setResult(data);
      })
      .finally(() => setCheckingPriorResponse(false));
  }, [slug, priorResponseId]);

  function setSingleAnswer(questionId: string, choice: string) {
    setAnswers((current) => ({ ...current, [questionId]: [choice] }));
  }

  function toggleMultiAnswer(questionId: string, choice: string) {
    setAnswers((current) => {
      const existing = current[questionId] ?? [];
      const next = existing.includes(choice) ? existing.filter((c) => c !== choice) : [...existing, choice];
      return { ...current, [questionId]: next };
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !email.trim() || !phone.trim() || !countryCode.trim() || !registrationNumber.trim()) {
      setError("Please fill in your name, email, phone number, country code, and registration number.");
      return;
    }
    const unanswered = questions.find((q) => (answers[q.id] ?? []).length === 0);
    if (unanswered) {
      setError("Please answer every question before submitting.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/quiz/${slug}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          countryCode,
          registrationNumber,
          answers: questions.map((q) => ({ questionId: q.id, selectedChoices: answers[q.id] ?? [] })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not submit this quiz.");
      saveQuizResponseId(slug, data.responseId);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit this quiz.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (checkingPriorResponse) {
    return <p className="text-ink-soft">Loading…</p>;
  }

  if (result) {
    const pct = result.totalQuestions > 0 ? Math.round((result.score / result.totalQuestions) * 100) : 0;
    return (
      <div className="card flex flex-col gap-4 p-6">
        <h1 className="text-3xl">{title}</h1>
        <p className="text-lg font-semibold text-brand-ink">
          You scored {result.score} / {result.totalQuestions} ({pct}%)
        </p>
        <button type="button" onClick={() => setViewFull((v) => !v)} className="btn btn-secondary self-start">
          {viewFull ? "Hide full quiz" : "View Full Quiz"}
        </button>
        {viewFull && (
          <ol className="flex flex-col gap-3">
            {result.answers.map((answer, index) => (
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
                        {wasSelected ? " (your answer)" : ""}
                      </li>
                    );
                  })}
                </ul>
                <p className={`mt-2 text-xs font-bold ${answer.correct ? "text-success" : "text-danger"}`}>
                  {answer.correct ? "Correct" : "Incorrect"}
                </p>
                {answer.explanation && <p className="mt-1 text-xs text-ink-soft">{answer.explanation}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl">{title}</h1>
        {description && <p className="mt-2 text-ink-soft">{description}</p>}
      </div>

      <div className="card flex flex-col gap-3 p-6">
        <p className="font-serif text-lg text-brand-ink">Your details</p>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Full name"
          maxLength={200}
          className="input-field"
        />
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
          maxLength={200}
          className="input-field"
        />
        <div className="grid grid-cols-[10rem_1fr] gap-3">
          <select
            value={countryCode}
            onChange={(event) => setCountryCode(event.target.value)}
            className="input-field"
          >
            <option value="" disabled>
              Code
            </option>
            {COUNTRY_CODES.map((country) => (
              <option key={country.iso2} value={country.dialCode}>
                {country.name} ({country.dialCode})
              </option>
            ))}
          </select>
          <input
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="Phone number"
            maxLength={30}
            className="input-field"
          />
        </div>
        <input
          value={registrationNumber}
          onChange={(event) => setRegistrationNumber(event.target.value)}
          placeholder="Registration number"
          maxLength={100}
          className="input-field"
        />
      </div>

      <ol className="flex flex-col gap-4">
        {questions.map((question, index) => {
          const isMultiSelect = question.type === "MULTI_SELECT";
          const selected = answers[question.id] ?? [];
          return (
            <li key={question.id} className="card flex flex-col gap-2 p-5">
              <p className="font-semibold text-ink">
                {index + 1}. {question.question}
              </p>
              <ul className="flex flex-col gap-2 text-sm">
                {question.choices.map((choice) => (
                  <li key={choice}>
                    <label className="flex items-center gap-2">
                      <input
                        type={isMultiSelect ? "checkbox" : "radio"}
                        name={isMultiSelect ? undefined : `question-${question.id}`}
                        checked={selected.includes(choice)}
                        onChange={() =>
                          isMultiSelect ? toggleMultiAnswer(question.id, choice) : setSingleAnswer(question.id, choice)
                        }
                      />
                      {choice}
                    </label>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>

      <button type="submit" disabled={isSubmitting} className="btn btn-primary self-start">
        {isSubmitting ? "Submitting…" : "Submit quiz"}
      </button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </form>
  );
}
