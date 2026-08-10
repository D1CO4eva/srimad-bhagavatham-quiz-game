import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { HostLobby } from "./HostLobby";
import type { QuestionStartPayload } from "@/lib/events";

export const dynamic = "force-dynamic";

export default async function HostLobbyPage({
  params,
}: {
  params: Promise<{ pin: string }>;
}) {
  const { pin } = await params;
  const session = await db.gameSession.findFirst({
    where: { pin, status: { not: "COMPLETED" } },
    include: {
      quiz: true,
      questions: { orderBy: { order: "asc" }, include: { _count: { select: { answers: true } } } },
      players: { orderBy: { joinedAt: "asc" } },
    },
  });

  if (!session) notFound();

  const current =
    session.currentQuestionIndex >= 0 ? session.questions[session.currentQuestionIndex] : null;

  const initialQuestion: QuestionStartPayload | null = current
    ? {
        questionId: current.id,
        questionIndex: current.order,
        type: current.type,
        question: current.question,
        choices: current.choices,
        timeLimitSecs: current.timeLimitSecs,
        startedAt: current.startedAt?.getTime() ?? null,
      }
    : null;

  return (
    <HostLobby
      pin={session.pin}
      quizTitle={session.quiz.title}
      questionCount={session.questions.length}
      initialPlayers={session.players.map((player) => ({
        id: player.id,
        nickname: player.nickname,
      }))}
      joinUrl={`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/join`}
      initialStarted={session.status === "ACTIVE"}
      initialQuestion={initialQuestion}
      initialLocked={Boolean(current?.lockedAt)}
      initialAnsweredCount={current?._count.answers ?? 0}
      initialPlayerCount={session.players.length}
    />
  );
}
