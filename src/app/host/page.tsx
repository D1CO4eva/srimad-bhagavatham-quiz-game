import { db } from "@/lib/db";
import { StartGameButton } from "./StartGameButton";

export const dynamic = "force-dynamic";

export default async function HostPage() {
  const quizzes = await db.quiz.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      description: true,
      _count: { select: { questions: true } },
    },
  });

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <div>
        <span className="pill-badge">Host</span>
        <h1 className="mt-3 text-4xl">Pick a quiz</h1>
        <p className="mt-2 text-ink-soft">Start a new live session from an existing quiz.</p>
      </div>

      {quizzes.length === 0 ? (
        <p className="text-ink-soft">No quizzes yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {quizzes.map((quiz) => (
            <li key={quiz.id} className="card flex items-center justify-between gap-4 p-5">
              <div>
                <p className="font-serif text-xl text-brand-ink">{quiz.title}</p>
                <p className="text-sm text-ink-soft">
                  {quiz._count.questions} question
                  {quiz._count.questions === 1 ? "" : "s"}
                </p>
              </div>
              <StartGameButton quizId={quiz.id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
