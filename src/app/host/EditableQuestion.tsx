"use client";

import { useState } from "react";

type Question = {
  id: string;
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER";
  question: string;
  choices: string[];
  answer: string;
};

export function EditableQuestion({
  quizId,
  question,
  index,
  onSaved,
}: {
  quizId: string;
  question: Question;
  index: number;
  onSaved: (updated: { choices: string[]; answer: string }) => void;
}) {
  const [savedChoices, setSavedChoices] = useState(question.choices);
  const [savedAnswer, setSavedAnswer] = useState(question.answer);
  const [choices, setChoices] = useState(question.choices);
  const [answer, setAnswer] = useState(question.answer);
  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editableChoiceText = question.type === "MULTIPLE_CHOICE";
  const dirty = answer !== savedAnswer || choices.some((choice, i) => choice !== savedChoices[i]);

  function updateChoiceText(choiceIndex: number, value: string) {
    setError(null);
    setJustSaved(false);
    setChoices((current) => {
      const previousValue = current[choiceIndex];
      const next = [...current];
      next[choiceIndex] = value;
      // The answer is stored by text, not index — keep it pointing at the
      // same choice as its text changes underneath it.
      if (answer === previousValue) setAnswer(value);
      return next;
    });
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const body: { choices?: string[]; answer: string } = editableChoiceText
        ? { choices, answer }
        : { answer };
      const response = await fetch(`/api/quizzes/${quizId}/questions/${question.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save this question.");
      setChoices(data.choices);
      setAnswer(data.answer);
      setSavedChoices(data.choices);
      setSavedAnswer(data.answer);
      setJustSaved(true);
      onSaved({ choices: data.choices, answer: data.answer });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this question.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <li className="rounded-2xl border border-line p-4 text-sm">
      <p className="font-semibold text-ink">
        {index + 1}. {question.question}
      </p>
      <p className="mt-1 text-xs text-ink-soft">Select the correct answer{editableChoiceText ? " and edit choice text" : ""}.</p>
      <ul className="mt-2 flex flex-col gap-2">
        {choices.map((choice, choiceIndex) => (
          <li key={choiceIndex} className="flex items-center gap-2">
            <input
              type="radio"
              name={`answer-${question.id}`}
              checked={choice === answer}
              onChange={() => {
                setAnswer(choice);
                setError(null);
                setJustSaved(false);
              }}
              aria-label={`Mark "${choice}" as the correct answer`}
            />
            {editableChoiceText ? (
              <input
                value={choice}
                onChange={(event) => updateChoiceText(choiceIndex, event.target.value)}
                maxLength={200}
                className="input-field flex-1"
              />
            ) : (
              <span className={choice === answer ? "font-semibold text-ink" : "text-ink-soft"}>{choice}</span>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || isSaving}
          className="btn btn-secondary"
        >
          {isSaving ? "Saving…" : "Save answer"}
        </button>
        {justSaved && !dirty && <span className="text-xs font-semibold text-success">Saved</span>}
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    </li>
  );
}
