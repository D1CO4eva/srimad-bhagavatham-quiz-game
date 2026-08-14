import { db } from "@/lib/db";
import { GenerateQuizForm } from "./GenerateQuizForm";
import { QuizDraftCard } from "./QuizDraftCard";
import { PublishedQuizCard } from "./PublishedQuizCard";
import { getCourseCatalog, toPublicCourseWeeks } from "@/lib/courseCatalog";
import { logoutHostAction } from "./login/actions";

export const dynamic = "force-dynamic";

export default async function HostPage() {
  const [catalog, drafts, published] = await Promise.all([
    getCourseCatalog(),
    db.quiz.findMany({
      where: { status: "DRAFT", mode: "LIVE" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        showLeaderboardDefault: true,
        showTimerDefault: true,
        scoringMode: true,
        leadTimeSecs: true,
        questions: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            type: true,
            question: true,
            choices: true,
            correctChoices: true,
            timeLimitSecs: true,
          },
        },
      },
    }),
    db.quiz.findMany({
      where: { status: "PUBLISHED", mode: "LIVE" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        _count: { select: { questions: true } },
        questions: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            type: true,
            question: true,
            choices: true,
            correctChoices: true,
            timeLimitSecs: true,
          },
        },
      },
    }),
  ]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-16 lg:max-w-4xl xl:max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="pill-badge">Host</span>
          <h1 className="mt-3 text-4xl">Pick a quiz</h1>
          <p className="mt-2 text-ink-soft">Generate a new quiz, or start a live session from an existing one.</p>
        </div>
        <form action={logoutHostAction}>
          <button type="submit" className="text-sm font-semibold text-ink-soft underline">
            Log out
          </button>
        </form>
      </div>

      <GenerateQuizForm weeks={toPublicCourseWeeks(catalog)} />

      {drafts.length > 0 && (
        <div>
          <h2 className="text-2xl">Drafts</h2>
          <p className="mt-1 text-sm text-ink-soft">Review, rename, and publish before these can be started.</p>
          <ul className="mt-3 flex flex-col gap-3">
            {drafts.map((quiz) => (
              <QuizDraftCard key={quiz.id} quiz={quiz} />
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="text-2xl">Quizzes ready to run</h2>
        {published.length === 0 ? (
          <p className="mt-2 text-ink-soft">No published quizzes yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {published.map((quiz) => (
              <PublishedQuizCard
                key={quiz.id}
                quiz={{
                  id: quiz.id,
                  title: quiz.title,
                  questionCount: quiz._count.questions,
                  questions: quiz.questions,
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
