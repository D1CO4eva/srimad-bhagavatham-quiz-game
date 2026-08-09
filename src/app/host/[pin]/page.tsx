import { db } from "@/lib/db";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HostLobbyPage({
  params,
}: {
  params: Promise<{ pin: string }>;
}) {
  const { pin } = await params;
  const session = await db.gameSession.findFirst({
    where: { pin, status: { not: "COMPLETED" } },
    include: { quiz: true, questions: true },
  });

  if (!session) notFound();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <p className="text-sm uppercase tracking-widest text-zinc-500">
          {session.quiz.title}
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          Join at {process.env.NEXT_PUBLIC_APP_URL ?? ""}/join
        </p>
      </div>
      <p className="font-mono text-8xl font-bold tracking-widest">{session.pin}</p>
      <p className="text-zinc-500">
        {session.questions.length} question
        {session.questions.length === 1 ? "" : "s"} &middot; waiting for
        players to join
      </p>
    </div>
  );
}
