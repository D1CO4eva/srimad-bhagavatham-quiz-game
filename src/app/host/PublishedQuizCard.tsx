"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StartGameButton } from "./StartGameButton";

export function PublishedQuizCard({
  quiz,
}: {
  quiz: { id: string; title: string; questionCount: number };
}) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!window.confirm(`Delete "${quiz.title}"? This can't be undone.`)) return;
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
    <li className="card flex items-center justify-between gap-4 p-5">
      <div>
        <p className="font-serif text-xl text-brand-ink">{quiz.title}</p>
        <p className="text-sm text-ink-soft">
          {quiz.questionCount} question
          {quiz.questionCount === 1 ? "" : "s"}
        </p>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting}
          className="btn btn-secondary text-danger"
        >
          {isDeleting ? "Deleting…" : "Delete"}
        </button>
        <StartGameButton quizId={quiz.id} />
      </div>
    </li>
  );
}
