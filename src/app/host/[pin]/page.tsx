import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { HostLobby } from "./HostLobby";
import type { LeaderboardEntry, QuestionStartPayload } from "@/lib/events";

export const dynamic = "force-dynamic";

export default async function HostLobbyPage({
  params,
}: {
  params: Promise<{ pin: string }>;
}) {
  const { pin } = await params;
  // Most recent session for this PIN — a PIN can be reused across sessions
  // once the earlier one is COMPLETED (Story 1.3), so this is either the
  // live session or, once the game has ended, the one to show the podium
  // for on reload.
  const session = await db.gameSession.findFirst({
    where: { pin },
    orderBy: { createdAt: "desc" },
    include: {
      quiz: true,
      questions: { orderBy: { order: "asc" }, include: { _count: { select: { answers: true } } } },
      players: { orderBy: { joinedAt: "asc" } },
      results: { orderBy: { rank: "asc" }, take: 3 },
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
        optionsRevealedAt: current.optionsRevealedAt?.getTime() ?? null,
      }
    : null;

  const initialPodium: LeaderboardEntry[] | null =
    session.status === "COMPLETED"
      ? session.results.map((result) => ({
          playerId: result.playerId,
          nickname: result.nickname,
          points: result.totalPoints,
          rank: result.rank,
        }))
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
      initialPodium={initialPodium}
      initialShowLeaderboard={session.showLeaderboard}
      initialShowTimer={session.showTimer}
    />
  );
}
