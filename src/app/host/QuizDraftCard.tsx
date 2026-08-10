"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type DraftQuestion = {
  id: string;
  question: string;
  choices: string[];
  answer: string;
};

export function QuizDraftCard({ quiz }: { quiz: { id: string; title: string; questions: DraftQuestion[] } }) {
  const router = useRouter();
  const [title, setTitle] = useState(quiz.title);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function patch(body: { title?: string; publish?: boolean }) {
    const response = await fetch(`/api/quizzes/${quiz.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Something went wrong.");
    return data;
  }

  async function handleSaveName() {
    setIsSaving(true);
    setError(null);
    try {
      await patch({ title });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the name.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePublish() {
    setIsPublishing(true);
    setError(null);
    try {
      await patch({ title, publish: true });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish this quiz.");
      setIsPublishing(false);
    }
  }

  return (
    <li className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          className="input-field flex-1 min-w-[12rem]"
        />
        <button type="button" onClick={handleSaveName} disabled={isSaving} className="btn btn-secondary">
          {isSaving ? "Saving…" : "Save name"}
        </button>
        <button type="button" onClick={handlePublish} disabled={isPublishing} className="btn btn-primary">
          {isPublishing ? "Publishing…" : "Publish"}
        </button>
      </div>

      <div className="flex items-center justify-between text-sm text-ink-soft">
        <span>
          {quiz.questions.length} question{quiz.questions.length === 1 ? "" : "s"} · Draft
        </span>
        <button type="button" onClick={() => setExpanded((v) => !v)} className="font-semibold text-brand-ink">
          {expanded ? "Hide questions" : "Preview questions"}
        </button>
      </div>

      {expanded && (
        <ol className="flex flex-col gap-3">
          {quiz.questions.map((question, index) => (
            <li key={question.id} className="rounded-2xl border border-line p-4 text-sm">
              <p className="font-semibold text-ink">
                {index + 1}. {question.question}
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {question.choices.map((choice) => (
                  <li
                    key={choice}
                    className={choice === question.answer ? "font-semibold text-success" : "text-ink-soft"}
                  >
                    {choice === question.answer ? "✓ " : "— "}
                    {choice}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
    </li>
  );
}
