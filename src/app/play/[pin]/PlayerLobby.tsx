"use client";

import { useEffect, useState } from "react";
import { createSessionRealtimeClient } from "@/lib/ably-client";
import { SessionEvent } from "@/lib/events";
import { measureLatency } from "@/lib/latency";

const LATENCY_REFRESH_MS = 45_000;

export function PlayerLobby({
  pin,
  playerId,
  nickname,
  initialGameStarted,
}: {
  pin: string;
  playerId: string;
  nickname: string;
  initialGameStarted: boolean;
}) {
  const [gameStarted, setGameStarted] = useState(initialGameStarted);

  useEffect(() => {
    const client = createSessionRealtimeClient(pin, playerId);
    const channel = client.channels.get(`game:${pin}`);
    const onGameStarted = () => setGameStarted(true);
    channel.subscribe(SessionEvent.GameStarted, onGameStarted);

    return () => {
      channel.unsubscribe(SessionEvent.GameStarted, onGameStarted);
      client.close();
    };
  }, [pin, playerId]);

  useEffect(() => {
    let cancelled = false;

    async function reportLatency() {
      const latency = await measureLatency();
      if (cancelled) return;
      await fetch(`/api/players/${playerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimatedLatencyMs: Math.round(latency) }),
      });
    }

    reportLatency();
    const interval = setInterval(reportLatency, LATENCY_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [playerId]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-lg font-medium">Hi, {nickname}!</p>
      {gameStarted ? (
        <p className="text-zinc-500">Game in progress — waiting for the next question...</p>
      ) : (
        <>
          <div
            className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-black dark:border-zinc-700 dark:border-t-white"
            aria-hidden
          />
          <p className="text-zinc-500">Waiting for the host to start the game...</p>
        </>
      )}
    </div>
  );
}
