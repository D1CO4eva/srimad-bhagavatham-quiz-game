import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { describeWindowState } from "@/lib/quizSchedule";
import { TakeQuizForm } from "./TakeQuizForm";

export const dynamic = "force-dynamic";

export default async function TakeQuizPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const quiz = await db.quiz.findUnique({
    where: { slug },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      mode: true,
      responsesOpen: true,
      opensAt: true,
      closesAt: true,
      questions: {
        orderBy: { order: "asc" },
        select: { id: true, order: true, type: true, question: true, choices: true },
      },
    },
  });

  if (!quiz || quiz.mode !== "SELF_PACED" || quiz.status !== "PUBLISHED") {
    notFound();
  }

  const windowState = describeWindowState(quiz);

  if (windowState !== "open") {
    const message =
      windowState === "not_open_yet"
        ? `This quiz opens on ${quiz.opensAt?.toLocaleString()}.`
        : windowState === "closed_by_window"
          ? `This quiz closed on ${quiz.closesAt?.toLocaleString()}.`
          : "This quiz has been closed by the host.";
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-4 px-6 py-16 text-center lg:max-w-xl">
        <h1 className="text-3xl">{quiz.title}</h1>
        <p className="text-ink-soft">{message}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-16 lg:max-w-3xl xl:max-w-4xl">
      <TakeQuizForm slug={slug} title={quiz.title} description={quiz.description} questions={quiz.questions} />
    </div>
  );
}
