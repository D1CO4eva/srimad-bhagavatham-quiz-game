import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { PlayerLobby } from "./PlayerLobby";
import type { LeaderboardEntry } from "@/lib/events";

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
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <p className="text-zinc-500">
          Missing player info. Join again from the{" "}
          <a href="/join" className="underline">
            join page
          </a>
          .
        </p>
      </div>
    );
  }

  // The player's own id already pins down which session (and its status)
  // they belong to — no ambiguity from a reused PIN the way the host's
  // PIN-only lookup has to handle.
  const player = await db.player.findUnique({
    where: { id: playerId },
    include: {
      gameSession: { include: { results: { orderBy: { rank: "asc" }, take: 3 } } },
    },
  });
  if (!player || player.gameSession.pin !== pin) notFound();

  const initialPodium: LeaderboardEntry[] | null =
    player.gameSession.status === "COMPLETED"
      ? player.gameSession.results.map((result) => ({
          playerId: result.playerId,
          nickname: result.nickname,
          points: result.totalPoints,
          rank: result.rank,
        }))
      : null;

  return (
    <PlayerLobby
      pin={pin}
      playerId={playerId}
      nickname={nickname}
      initialGameStarted={player.gameSession.status === "ACTIVE"}
      initialPodium={initialPodium}
    />
  );
}
