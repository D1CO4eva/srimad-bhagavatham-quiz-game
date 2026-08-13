"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EditableQuestion } from "./EditableQuestion";

type DraftQuestion = {
  id: string;
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER";
  question: string;
  choices: string[];
  answer: string;
  timeLimitSecs: number;
};

export function QuizDraftCard({ quiz }: { quiz: { id: string; title: string; questions: DraftQuestion[] } }) {
  const router = useRouter();
  const [title, setTitle] = useState(quiz.title);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  // Lifted out of EditableQuestion so a saved edit survives collapsing and
  // re-expanding the "Preview questions" panel.
  const [questions, setQuestions] = useState(quiz.questions);

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

  async function handleDelete() {
    if (!window.confirm(`Delete "${title}"? This can't be undone.`)) return;
    setIsDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/quizzes/${quiz.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not delete this quiz.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this quiz.");
      setIsDeleting(false);
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
        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting}
          className="btn btn-secondary text-danger"
        >
          {isDeleting ? "Deleting…" : "Delete"}
        </button>
      </div>

      <div className="flex items-center justify-between text-sm text-ink-soft">
        <span>
          {questions.length} question{questions.length === 1 ? "" : "s"} · Draft
        </span>
        <button type="button" onClick={() => setExpanded((v) => !v)} className="font-semibold text-brand-ink">
          {expanded ? "Hide questions" : "Preview questions"}
        </button>
      </div>

      {expanded && (
        <ol className="flex flex-col gap-3">
          {questions.map((question, index) => (
            <EditableQuestion
              key={question.id}
              quizId={quiz.id}
              question={question}
              index={index}
              canDelete={questions.length > 1}
              onSaved={(updated) =>
                setQuestions((current) =>
                  current.map((q) => (q.id === question.id ? { ...q, ...updated } : q))
                )
              }
              onDeleted={() =>
                setQuestions((current) => current.filter((q) => q.id !== question.id))
              }
            />
          ))}
        </ol>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
    </li>
  );
}
