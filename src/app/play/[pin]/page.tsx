import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { PlayerLobby } from "./PlayerLobby";

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

  const session = await db.gameSession.findFirst({
    where: { pin, status: { not: "COMPLETED" } },
    select: { status: true },
  });
  if (!session) notFound();

  return (
    <PlayerLobby
      pin={pin}
      playerId={playerId}
      nickname={nickname}
      initialGameStarted={session.status === "ACTIVE"}
    />
  );
}
