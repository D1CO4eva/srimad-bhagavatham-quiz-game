"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeWindowState, type WindowState } from "@/lib/quizSchedule";
import { ScheduleWindowPicker } from "./ScheduleWindowPicker";

type PublishedQuestion = {
  id: string;
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER" | "MULTI_SELECT";
  question: string;
  choices: string[];
  correctChoices: string[];
  timeLimitSecs: number;
};

const STATUS_LABEL: Record<WindowState, string> = {
  open: "Open — accepting responses",
  not_open_yet: "Not open yet",
  closed_by_window: "Closed (window ended)",
  closed_by_host: "Closed",
};

export function SelfPacedQuizCard({
  quiz,
}: {
  quiz: {
    id: string;
    title: string;
    slug: string | null;
    responsesOpen: boolean;
    opensAt: string | null;
    closesAt: string | null;
    questionCount: number;
    responseCount: number;
    questions: PublishedQuestion[];
  };
}) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [responsesOpen, setResponsesOpen] = useState(quiz.responsesOpen);
  const [opensAt, setOpensAt] = useState(quiz.opensAt);
  const [closesAt, setClosesAt] = useState(quiz.closesAt);

  const link = quiz.slug && typeof window !== "undefined" ? `${window.location.origin}/quiz/${quiz.slug}` : `/quiz/${quiz.slug}`;
  const windowState = describeWindowState({
    status: "PUBLISHED",
    mode: "SELF_PACED",
    responsesOpen,
    opensAt: opensAt ? new Date(opensAt) : null,
    closesAt: closesAt ? new Date(closesAt) : null,
  });

  async function handleToggleOpen() {
    const next = !responsesOpen;
    setIsToggling(true);
    setError(null);
    try {
      const response = await fetch(`/api/quizzes/${quiz.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responsesOpen: next }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not update this quiz.");
      setResponsesOpen(data.responsesOpen);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update this quiz.");
    } finally {
      setIsToggling(false);
    }
  }

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
    <li className="card flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-serif text-xl text-brand-ink">{quiz.title}</p>
          <p className="text-sm text-ink-soft">
            {quiz.questionCount} question{quiz.questionCount === 1 ? "" : "s"} · {quiz.responseCount} response
            {quiz.responseCount === 1 ? "" : "s"} · {STATUS_LABEL[windowState]}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button type="button" onClick={handleToggleOpen} disabled={isToggling} className="btn btn-secondary">
            {responsesOpen ? "Close responses" : "Open responses"}
          </button>
          <Link href={`/manage-quizzes/self-paced/${quiz.id}/scores`} className="btn btn-primary">
            Check Scores
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <code className="flex-1 min-w-[12rem] rounded-xl border border-line bg-paper-deep px-3 py-2">{link}</code>
        <button type="button" onClick={() => navigator.clipboard.writeText(link)} className="btn btn-secondary">
          Copy link
        </button>
      </div>

      <ScheduleWindowPicker
        quizId={quiz.id}
        initialOpensAt={opensAt}
        initialClosesAt={closesAt}
        onSaved={(next) => {
          setOpensAt(next.opensAt);
          setClosesAt(next.closesAt);
        }}
      />

      <div className="flex items-center justify-between border-t border-line pt-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-sm font-semibold text-brand-ink"
        >
          {expanded ? "Hide questions" : "Preview questions"}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting || quiz.responseCount > 0}
          title={quiz.responseCount > 0 ? "This quiz has responses and can't be deleted." : undefined}
          className="btn btn-secondary text-danger"
        >
          {isDeleting ? "Deleting…" : "Delete"}
        </button>
      </div>

      {expanded && (
        <ol className="flex flex-col gap-2 text-sm">
          {quiz.questions.map((question, index) => (
            <li key={question.id} className="rounded-2xl border border-line p-3">
              <p className="font-semibold text-ink">
                {index + 1}. {question.question}
              </p>
              <ul className="mt-1 flex flex-col gap-0.5 text-xs text-ink-soft">
                {question.choices.map((choice) => (
                  <li key={choice} className={question.correctChoices.includes(choice) ? "font-semibold text-success" : ""}>
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
