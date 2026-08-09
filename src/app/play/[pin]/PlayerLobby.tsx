"use client";

import { useEffect, useState } from "react";
import { createSessionRealtimeClient } from "@/lib/ably-client";
import { SessionEvent, type QuestionStartPayload } from "@/lib/events";
import { measureLatency } from "@/lib/latency";
import { useCountdown } from "@/lib/useCountdown";
import { ANSWER_SHAPES } from "@/lib/answerShapes";
import type { InboundMessage } from "ably";

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
  const [question, setQuestion] = useState<QuestionStartPayload | null>(null);
  const [locked, setLocked] = useState(false);
  const [myChoice, setMyChoice] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const remaining = useCountdown(question?.startedAt ?? null, question?.timeLimitSecs ?? 0);

  useEffect(() => {
    const client = createSessionRealtimeClient(pin, playerId);
    const channel = client.channels.get(`game:${pin}`);
    const onGameStarted = () => setGameStarted(true);
    const onQuestionStart = (message: InboundMessage) => {
      setQuestion(message.data as QuestionStartPayload);
      setLocked(false);
      setMyChoice(null);
      setSubmitError(null);
    };
    const onQuestionLocked = () => setLocked(true);

    channel.subscribe(SessionEvent.GameStarted, onGameStarted);
    channel.subscribe(SessionEvent.QuestionStart, onQuestionStart);
    channel.subscribe(SessionEvent.QuestionLocked, onQuestionLocked);

    return () => {
      channel.unsubscribe(SessionEvent.GameStarted, onGameStarted);
      channel.unsubscribe(SessionEvent.QuestionStart, onQuestionStart);
      channel.unsubscribe(SessionEvent.QuestionLocked, onQuestionLocked);
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

  async function handleAnswer(choiceIndex: number) {
    if (myChoice !== null || locked || !question) return;
    setMyChoice(choiceIndex);
    setSubmitError(null);
    try {
      const response = await fetch(`/api/sessions/${pin}/answers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, questionId: question.questionId, choiceIndex }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setSubmitError(data.error ?? "Too late — that answer wasn't counted.");
      }
    } catch {
      setSubmitError("Couldn't reach the server — that answer wasn't counted.");
    }
  }

  if (question) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
        <p className="font-mono text-3xl font-bold">{remaining}</p>
        {myChoice !== null ? (
          <p className="text-lg text-zinc-500">
            {submitError ?? "Answer locked in!"}
          </p>
        ) : locked ? (
          <p className="text-lg text-zinc-500">Time&apos;s up!</p>
        ) : (
          <p className="text-lg text-zinc-500">Tap your answer</p>
        )}
        <div className="grid w-full max-w-sm grid-cols-2 gap-4">
          {question.choices.map((_, index) => {
            const shape = ANSWER_SHAPES[index % ANSWER_SHAPES.length];
            const disabled = myChoice !== null || locked;
            return (
              <button
                key={index}
                type="button"
                disabled={disabled}
                onClick={() => handleAnswer(index)}
                className="aspect-square rounded-xl text-white transition-opacity disabled:opacity-40"
                style={{ backgroundColor: shape.color }}
                aria-label={shape.label}
              />
            );
          })}
        </div>
      </div>
    );
  }

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
