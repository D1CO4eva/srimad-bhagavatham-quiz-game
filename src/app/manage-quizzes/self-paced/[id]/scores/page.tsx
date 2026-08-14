import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { summarizeResponses } from "@/lib/quizAnalytics";
import { ResponseRow } from "./ResponseRow";

export const dynamic = "force-dynamic";

export default async function SelfPacedScoresPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const quiz = await db.quiz.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      mode: true,
      questions: { orderBy: { order: "asc" }, select: { id: true, question: true } },
      responses: {
        orderBy: { submittedAt: "desc" },
        select: {
          id: true,
          respondentName: true,
          respondentEmail: true,
          respondentPhone: true,
          respondentCountryCode: true,
          respondentRegNo: true,
          score: true,
          totalQuestions: true,
          answers: true,
          submittedAt: true,
        },
      },
    },
  });

  if (!quiz || quiz.mode !== "SELF_PACED") {
    notFound();
  }

  const summary = summarizeResponses(quiz.questions, quiz.responses);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-6 py-16 lg:max-w-5xl xl:max-w-6xl">
      <div>
        <Link href="/manage-quizzes/self-paced" className="text-sm font-semibold text-ink-soft underline">
          ‹ Back to self-paced quizzes
        </Link>
        <h1 className="mt-3 text-4xl">{quiz.title}</h1>
        <p className="mt-2 text-ink-soft">Scores and answer breakdown for every student who has submitted.</p>
      </div>

      <div className="card grid grid-cols-2 gap-4 p-6 sm:grid-cols-3">
        <div>
          <p className="text-2xl font-bold text-brand-ink">{summary.responseCount}</p>
          <p className="text-sm text-ink-soft">Responses</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-brand-ink">
            {summary.averageScorePct === null ? "—" : `${Math.round(summary.averageScorePct)}%`}
          </p>
          <p className="text-sm text-ink-soft">Average score</p>
        </div>
      </div>

      {summary.mostMissed.length > 0 && (
        <div>
          <h2 className="text-2xl">Most missed questions</h2>
          <ol className="mt-3 flex flex-col gap-2">
            {summary.mostMissed.map((entry, index) => (
              <li key={entry.questionId} className="card p-4 text-sm">
                <p className="font-semibold text-ink">
                  {index + 1}. {entry.question}
                </p>
                <p className="mt-1 text-ink-soft">
                  Missed by {entry.missCount} of {summary.responseCount} ({Math.round(entry.missPct)}%)
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div>
        <h2 className="text-2xl">Responses</h2>
        {quiz.responses.length === 0 ? (
          <p className="mt-2 text-ink-soft">No one has submitted this quiz yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {quiz.responses.map((response) => (
              <ResponseRow key={response.id} response={response} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
