"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function JoinPage() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [nickname, setNickname] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsJoining(true);
    setError(null);
    try {
      const response = await fetch("/api/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, nickname }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not join.");
      router.push(`/play/${pin}?playerId=${data.playerId}&nickname=${encodeURIComponent(data.nickname)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join.");
      setIsJoining(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Join a game</h1>
      <form onSubmit={handleSubmit} className="flex w-full max-w-xs flex-col gap-4">
        <input
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
          placeholder="Game PIN"
          inputMode="numeric"
          maxLength={6}
          className="rounded-lg border border-zinc-300 px-4 py-3 text-center text-2xl tracking-widest dark:border-zinc-700 dark:bg-zinc-900"
          required
        />
        <input
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          placeholder="Nickname"
          maxLength={30}
          className="rounded-lg border border-zinc-300 px-4 py-3 text-center text-lg dark:border-zinc-700 dark:bg-zinc-900"
          required
        />
        <button
          type="submit"
          disabled={isJoining}
          className="rounded-full bg-black px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {isJoining ? "Joining..." : "Join"}
        </button>
        {error && <p className="text-center text-sm text-red-600">{error}</p>}
      </form>
    </div>
  );
}
