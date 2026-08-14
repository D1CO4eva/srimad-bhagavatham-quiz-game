import { db } from "@/lib/db";
import { GenerateQuizForm } from "@/app/host/GenerateQuizForm";
import { getCourseCatalog, toPublicCourseWeeks } from "@/lib/courseCatalog";
import { logoutHostAction } from "@/app/host/login/actions";
import { SelfPacedDraftCard } from "./SelfPacedDraftCard";
import { SelfPacedQuizCard } from "./SelfPacedQuizCard";

export const dynamic = "force-dynamic";

export default async function SelfPacedDashboardPage() {
  const [catalog, drafts, published] = await Promise.all([
    getCourseCatalog(),
    db.quiz.findMany({
      where: { status: "DRAFT", mode: "SELF_PACED" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        slug: true,
        responsesOpen: true,
        opensAt: true,
        closesAt: true,
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
      where: { status: "PUBLISHED", mode: "SELF_PACED" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        slug: true,
        responsesOpen: true,
        opensAt: true,
        closesAt: true,
        _count: { select: { questions: true, responses: true } },
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
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="pill-badge">Host · Self-Paced</span>
          <h1 className="mt-3 text-4xl">Pick a quiz</h1>
          <p className="mt-2 text-ink-soft">
            Generate a new quiz, then publish it to get a shareable link students fill out on their own time.
          </p>
        </div>
        <form action={logoutHostAction}>
          <button type="submit" className="text-sm font-semibold text-ink-soft underline">
            Log out
          </button>
        </form>
      </div>

      <GenerateQuizForm weeks={toPublicCourseWeeks(catalog)} mode="SELF_PACED" />

      {drafts.length > 0 && (
        <div>
          <h2 className="text-2xl">Drafts</h2>
          <p className="mt-1 text-sm text-ink-soft">Review, rename, and publish before students can take these.</p>
          <ul className="mt-3 flex flex-col gap-3">
            {drafts.map((quiz) => (
              <SelfPacedDraftCard key={quiz.id} quiz={quiz} />
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="text-2xl">Published quizzes</h2>
        {published.length === 0 ? (
          <p className="mt-2 text-ink-soft">No published self-paced quizzes yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {published.map((quiz) => (
              <SelfPacedQuizCard
                key={quiz.id}
                quiz={{
                  id: quiz.id,
                  title: quiz.title,
                  slug: quiz.slug,
                  responsesOpen: quiz.responsesOpen,
                  opensAt: quiz.opensAt ? quiz.opensAt.toISOString() : null,
                  closesAt: quiz.closesAt ? quiz.closesAt.toISOString() : null,
                  questionCount: quiz._count.questions,
                  responseCount: quiz._count.responses,
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
