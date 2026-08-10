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
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Host a quiz</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Pick a quiz to start a new live session.
        </p>
      </div>

      {quizzes.length === 0 ? (
        <p className="text-zinc-500">No quizzes yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {quizzes.map((quiz) => (
            <li
              key={quiz.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div>
                <p className="font-medium">{quiz.title}</p>
                <p className="text-sm text-zinc-500">
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
