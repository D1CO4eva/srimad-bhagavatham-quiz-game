import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { HostLobby } from "./HostLobby";

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
      questions: true,
      players: { orderBy: { joinedAt: "asc" } },
    },
  });

  if (!session) notFound();

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
    />
  );
}
