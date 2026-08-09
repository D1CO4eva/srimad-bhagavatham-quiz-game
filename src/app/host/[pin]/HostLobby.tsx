"use client";

import { useEffect, useRef, useState } from "react";
import { createSessionRealtimeClient } from "@/lib/ably-client";
import { SessionEvent } from "@/lib/events";
import type { InboundMessage } from "ably";

type Player = { id: string; nickname: string };

export function HostLobby({
  pin,
  quizTitle,
  questionCount,
  initialPlayers,
  joinUrl,
}: {
  pin: string;
  quizTitle: string;
  questionCount: number;
  initialPlayers: Player[];
  joinUrl: string;
}) {
  const [players, setPlayers] = useState<Player[]>(initialPlayers);
  const [started, setStarted] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seenPlayerIds = useRef(new Set(initialPlayers.map((player) => player.id)));

  useEffect(() => {
    const client = createSessionRealtimeClient(pin, "host");
    const channel = client.channels.get(`game:${pin}`);

    const onPlayerJoined = (message: InboundMessage) => {
      const data = message.data as { playerId: string; nickname: string };
      if (seenPlayerIds.current.has(data.playerId)) return;
      seenPlayerIds.current.add(data.playerId);
      setPlayers((prev) => [...prev, { id: data.playerId, nickname: data.nickname }]);
    };

    channel.subscribe(SessionEvent.PlayerJoined, onPlayerJoined);

    return () => {
      channel.unsubscribe(SessionEvent.PlayerJoined, onPlayerJoined);
      client.close();
    };
  }, [pin]);

  async function handleStart() {
    setIsStarting(true);
    setError(null);
    try {
      const response = await fetch(`/api/sessions/${pin}/start`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not start the game.");
      setStarted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the game.");
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center gap-8 px-6 py-16 text-center">
      <div>
        <p className="text-sm uppercase tracking-widest text-zinc-500">{quizTitle}</p>
        <p className="mt-2 text-sm text-zinc-500">Join at {joinUrl}</p>
      </div>
      <p className="font-mono text-8xl font-bold tracking-widest">{pin}</p>

      {started ? (
        <p className="text-lg text-zinc-500">
          Game started — {questionCount} question{questionCount === 1 ? "" : "s"} queued up.
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={handleStart}
            disabled={players.length === 0 || isStarting}
            className="rounded-full bg-black px-8 py-3 text-base font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {isStarting ? "Starting..." : "Start Game"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </>
      )}

      <div className="w-full">
        <p className="mb-3 text-sm font-medium text-zinc-500">
          {players.length} player{players.length === 1 ? "" : "s"} joined
        </p>
        <ul className="flex flex-wrap justify-center gap-2">
          {players.map((player) => (
            <li
              key={player.id}
              className="rounded-full border border-zinc-200 px-3 py-1 text-sm dark:border-zinc-800"
            >
              {player.nickname}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
