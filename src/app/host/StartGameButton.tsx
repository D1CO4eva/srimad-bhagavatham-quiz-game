"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function StartGameButton({ quizId }: { quizId: string }) {
  const router = useRouter();
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setIsStarting(true);
    setError(null);
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizId }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to start the game.");
      }
      router.push(`/host/${data.pin}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start the game.");
      setIsStarting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isStarting}
        className="rounded-full bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
      >
        {isStarting ? "Starting..." : "Start Live Game"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
