import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { PlayerLobby } from "./PlayerLobby";
import { DynamicRejoinFromStorage as RejoinFromStorage } from "./DynamicRejoin";
import { toPublicQuestion } from "@/lib/questions";
import type { LeaderboardEntry, QuestionStartPayload } from "@/lib/events";

export const dynamic = "force-dynamic";

export default async function PlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ pin: string }>;
  searchParams: Promise<{ playerId?: string; nickname?: string }>;
}) {
  const { pin } = await params;
  const { playerId, nickname } = await searchParams;

  if (!playerId || !nickname) {
    return <RejoinFromStorage pin={pin} />;
  }

  // The player's own id already pins down which session (and its status)
  // they belong to — no ambiguity from a reused PIN the way the host's
  // PIN-only lookup has to handle.
  const player = await db.player.findUnique({
    where: { id: playerId },
    include: {
      gameSession: {
        include: {
          questions: { orderBy: { order: "asc" } },
          results: { orderBy: { rank: "asc" }, take: 3 },
        },
      },
    },
  });
  if (!player || player.gameSession.pin !== pin) notFound();

  const { gameSession } = player;
  const current =
    gameSession.currentQuestionIndex >= 0 ? gameSession.questions[gameSession.currentQuestionIndex] : null;

  // Story 7.1: resume the live question on reconnect — don't drop the
  // player back to "waiting" mid-question just because their connection did.
  let initialQuestion: QuestionStartPayload | null = null;
  let initialLocked = false;
  let initialMyChoices: number[] = [];
  let initialRevealedAnswers: string[] | null = null;
  if (gameSession.status === "ACTIVE" && current) {
    initialQuestion = toPublicQuestion(current);
    initialLocked = Boolean(current.lockedAt);
    initialRevealedAnswers = initialLocked ? current.correctChoices : null;
    const myAnswer = await db.answer.findUnique({
      where: { gameSessionQuestionId_playerId: { gameSessionQuestionId: current.id, playerId } },
      select: { choiceIndices: true },
    });
    initialMyChoices = myAnswer?.choiceIndices ?? [];
  }

  const initialPodium: LeaderboardEntry[] | null =
    gameSession.status === "COMPLETED"
      ? gameSession.results.map((result) => ({
          playerId: result.playerId,
          nickname: result.nickname,
          points: result.totalPoints,
          rank: result.rank,
        }))
      : null;
  const initialTotalPlayers =
    gameSession.status === "COMPLETED"
      ? await db.sessionResult.count({ where: { gameSessionId: gameSession.id } })
      : 0;

  return (
    <PlayerLobby
      pin={pin}
      playerId={playerId}
      nickname={nickname}
      initialGameStarted={gameSession.status === "ACTIVE"}
      initialPodium={initialPodium}
      initialTotalPlayers={initialTotalPlayers}
      initialQuestion={initialQuestion}
      initialLocked={initialLocked}
      initialMyChoices={initialMyChoices}
      initialRevealedAnswers={initialRevealedAnswers}
      initialShowLeaderboard={gameSession.showLeaderboard}
      initialShowTimer={gameSession.showTimer}
    />
  );
}
