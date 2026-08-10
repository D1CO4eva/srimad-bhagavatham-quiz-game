"use client";

import { useEffect, useState } from "react";
import { createSessionRealtimeClient } from "@/lib/ably-client";
import { SessionEvent, type LeaderboardEntry, type PodiumPayload, type QuestionStartPayload } from "@/lib/events";
import { measureLatency } from "@/lib/latency";
import { useCountdown } from "@/lib/useCountdown";
import { ANSWER_SHAPES } from "@/lib/answerShapes";
import { savePlayerSession } from "@/lib/playerSession";
import type { InboundMessage } from "ably";

const LATENCY_REFRESH_MS = 45_000;

export function PlayerLobby({
  pin,
  playerId,
  nickname,
  initialGameStarted,
  initialPodium,
  initialQuestion,
  initialLocked,
  initialMyChoice,
}: {
  pin: string;
  playerId: string;
  nickname: string;
  initialGameStarted: boolean;
  initialPodium: LeaderboardEntry[] | null;
  initialQuestion: QuestionStartPayload | null;
  initialLocked: boolean;
  initialMyChoice: number | null;
}) {
  const [gameStarted, setGameStarted] = useState(initialGameStarted);
  const [question, setQuestion] = useState<QuestionStartPayload | null>(initialQuestion);
  const [locked, setLocked] = useState(initialLocked);
  const [myChoice, setMyChoice] = useState<number | null>(initialMyChoice);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [myRank, setMyRank] = useState<{ rank: number; points: number } | null>(null);
  const [podium, setPodium] = useState<LeaderboardEntry[] | null>(initialPodium);

  const remaining = useCountdown(question?.startedAt ?? null, question?.timeLimitSecs ?? 0);

  // Keep sessionStorage in sync even when this page was reached directly
  // (a shared link, a bookmark) rather than through /join, so a later
  // refresh or re-visit to /join for this PIN still re-associates instead
  // of creating a duplicate Player (Story 7.1).
  useEffect(() => {
    savePlayerSession(pin, { playerId, nickname });
  }, [pin, playerId, nickname]);

  useEffect(() => {
    const client = createSessionRealtimeClient(pin, playerId);
    const channel = client.channels.get(`game:${pin}`);
    const onGameStarted = () => setGameStarted(true);
    const onQuestionStart = (message: InboundMessage) => {
      setQuestion(message.data as QuestionStartPayload);
      setLocked(false);
      setMyChoice(null);
      setSubmitError(null);
      setMyRank(null);
    };
    const onQuestionLocked = () => setLocked(true);
    const onPodium = (message: InboundMessage) => {
      setPodium((message.data as PodiumPayload).podium);
    };

    channel.subscribe(SessionEvent.GameStarted, onGameStarted);
    channel.subscribe(SessionEvent.QuestionStart, onQuestionStart);
    channel.subscribe(SessionEvent.QuestionLocked, onQuestionLocked);
    channel.subscribe(SessionEvent.Podium, onPodium);

    return () => {
      channel.unsubscribe(SessionEvent.GameStarted, onGameStarted);
      channel.unsubscribe(SessionEvent.QuestionStart, onQuestionStart);
      channel.unsubscribe(SessionEvent.QuestionLocked, onQuestionLocked);
      channel.unsubscribe(SessionEvent.Podium, onPodium);
      client.close();
    };
  }, [pin, playerId]);

  // Story 5.2: fetch our own rank once a question locks — a plain
  // authenticated GET is as private as this needs to be (see the rank
  // route's own comment for why this beats a per-player Ably channel).
  useEffect(() => {
    if (!locked) return;
    let cancelled = false;
    fetch(`/api/sessions/${pin}/rank?playerId=${playerId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.rank !== null) setMyRank(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [locked, pin, playerId]);

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

  if (podium) {
    const mine = podium.find((entry) => entry.playerId === playerId);
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">🏆 Game Over</h1>
        {mine ? (
          <p className="text-lg text-zinc-500">
            You placed #{mine.rank} with {mine.points} points!
          </p>
        ) : myRank ? (
          <p className="text-lg text-zinc-500">
            You placed #{myRank.rank} with {myRank.points} points.
          </p>
        ) : null}
      </div>
    );
  }

  if (question) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
        <p className="font-mono text-3xl font-bold">{remaining}</p>
        {myChoice !== null ? (
          <p className="text-lg text-zinc-500">{submitError ?? "Answer locked in!"}</p>
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
        {locked && myRank && (
          <p className="text-zinc-500">
            Rank #{myRank.rank} &middot; {myRank.points} points
          </p>
        )}
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
