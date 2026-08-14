"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EditableQuestion } from "@/app/host/EditableQuestion";
import { ScheduleWindowPicker } from "./ScheduleWindowPicker";

type DraftQuestion = {
  id: string;
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER" | "MULTI_SELECT";
  question: string;
  choices: string[];
  correctChoices: string[];
  timeLimitSecs: number;
};

export function SelfPacedDraftCard({
  quiz,
}: {
  quiz: {
    id: string;
    title: string;
    slug: string | null;
    responsesOpen: boolean;
    opensAt: Date | null;
    closesAt: Date | null;
    questions: DraftQuestion[];
  };
}) {
  const router = useRouter();
  const [title, setTitle] = useState(quiz.title);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [questions, setQuestions] = useState(quiz.questions);
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null);
  const [opensAt, setOpensAt] = useState(quiz.opensAt ? quiz.opensAt.toISOString() : null);
  const [closesAt, setClosesAt] = useState(quiz.closesAt ? quiz.closesAt.toISOString() : null);

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
      const data = await patch({ title, publish: true });
      setPublishedSlug(data.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish this quiz.");
    } finally {
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

  if (publishedSlug) {
    const link = typeof window !== "undefined" ? `${window.location.origin}/quiz/${publishedSlug}` : `/quiz/${publishedSlug}`;
    return (
      <li className="card flex flex-col gap-3 p-5">
        <p className="font-serif text-xl text-brand-ink">&ldquo;{title}&rdquo; is published!</p>
        <p className="text-sm text-ink-soft">Share this link with students:</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="flex-1 rounded-xl border border-line bg-paper-deep px-3 py-2 text-sm">{link}</code>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(link)}
            className="btn btn-secondary"
          >
            Copy link
          </button>
        </div>
        <button type="button" onClick={() => router.refresh()} className="btn btn-primary self-start">
          Continue to published quizzes
        </button>
      </li>
    );
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

      <div className="border-t border-line pt-4">
        <ScheduleWindowPicker
          quizId={quiz.id}
          initialOpensAt={opensAt}
          initialClosesAt={closesAt}
          onSaved={(next) => {
            setOpensAt(next.opensAt);
            setClosesAt(next.closesAt);
          }}
        />
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
