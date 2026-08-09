"use client";

import { useEffect, useRef, useState } from "react";
import { createSessionRealtimeClient } from "@/lib/ably-client";
import {
  SessionEvent,
  type AnswerCountUpdatePayload,
  type LeaderboardEntry,
  type LeaderboardUpdatePayload,
  type PodiumPayload,
  type QuestionStartPayload,
} from "@/lib/events";
import { useCountdown } from "@/lib/useCountdown";
import { ANSWER_SHAPES } from "@/lib/answerShapes";
import type { InboundMessage } from "ably";

type Player = { id: string; nickname: string };

export function HostLobby({
  pin,
  quizTitle,
  questionCount,
  initialPlayers,
  joinUrl,
  initialStarted,
  initialQuestion,
  initialLocked,
  initialAnsweredCount,
  initialPlayerCount,
  initialPodium,
}: {
  pin: string;
  quizTitle: string;
  questionCount: number;
  initialPlayers: Player[];
  joinUrl: string;
  initialStarted: boolean;
  initialQuestion: QuestionStartPayload | null;
  initialLocked: boolean;
  initialAnsweredCount: number;
  initialPlayerCount: number;
  initialPodium: LeaderboardEntry[] | null;
}) {
  const [players, setPlayers] = useState<Player[]>(initialPlayers);
  const [started, setStarted] = useState(initialStarted);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seenPlayerIds = useRef(new Set(initialPlayers.map((player) => player.id)));

  const [question, setQuestion] = useState<QuestionStartPayload | null>(initialQuestion);
  const [locked, setLocked] = useState(initialLocked);
  const [answeredCount, setAnsweredCount] = useState(initialAnsweredCount);
  const [playerCount, setPlayerCount] = useState(initialPlayerCount);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [podium, setPodium] = useState<LeaderboardEntry[] | null>(initialPodium);

  const remaining = useCountdown(question?.startedAt ?? null, question?.timeLimitSecs ?? 0);
  const isLastQuestion = question !== null && question.questionIndex === questionCount - 1;

  useEffect(() => {
    const client = createSessionRealtimeClient(pin, "host");
    const channel = client.channels.get(`game:${pin}`);

    const onPlayerJoined = (message: InboundMessage) => {
      const data = message.data as { playerId: string; nickname: string; playerCount: number };
      if (!seenPlayerIds.current.has(data.playerId)) {
        seenPlayerIds.current.add(data.playerId);
        setPlayers((prev) => [...prev, { id: data.playerId, nickname: data.nickname }]);
      }
      setPlayerCount(data.playerCount);
    };
    const onQuestionStart = (message: InboundMessage) => {
      const data = message.data as QuestionStartPayload;
      setQuestion(data);
      setLocked(false);
      setAnsweredCount(0);
      setLeaderboard(null);
    };
    const onAnswerCountUpdate = (message: InboundMessage) => {
      const data = message.data as AnswerCountUpdatePayload;
      setAnsweredCount(data.answeredCount);
      setPlayerCount(data.playerCount);
    };
    const onQuestionLocked = () => {
      setLocked(true);
    };
    const onLeaderboardUpdate = (message: InboundMessage) => {
      setLeaderboard((message.data as LeaderboardUpdatePayload).leaderboard);
    };
    const onPodium = (message: InboundMessage) => {
      setPodium((message.data as PodiumPayload).podium);
    };

    channel.subscribe(SessionEvent.PlayerJoined, onPlayerJoined);
    channel.subscribe(SessionEvent.QuestionStart, onQuestionStart);
    channel.subscribe(SessionEvent.AnswerCountUpdate, onAnswerCountUpdate);
    channel.subscribe(SessionEvent.QuestionLocked, onQuestionLocked);
    channel.subscribe(SessionEvent.LeaderboardUpdate, onLeaderboardUpdate);
    channel.subscribe(SessionEvent.Podium, onPodium);

    return () => {
      channel.unsubscribe(SessionEvent.PlayerJoined, onPlayerJoined);
      channel.unsubscribe(SessionEvent.QuestionStart, onQuestionStart);
      channel.unsubscribe(SessionEvent.AnswerCountUpdate, onAnswerCountUpdate);
      channel.unsubscribe(SessionEvent.QuestionLocked, onQuestionLocked);
      channel.unsubscribe(SessionEvent.LeaderboardUpdate, onLeaderboardUpdate);
      channel.unsubscribe(SessionEvent.Podium, onPodium);
      client.close();
    };
  }, [pin]);

  // Auto-lock once the host's own countdown hits zero, so the UI moves on
  // even if no one clicks "Lock Now". The server deadline is authoritative
  // either way (Story 3.3).
  useEffect(() => {
    if (question && remaining === 0 && !locked) {
      fetch(`/api/sessions/${pin}/lock`, { method: "POST" }).catch(() => {});
    }
  }, [remaining, question, pin, locked]);

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

  async function handleNext() {
    setIsAdvancing(true);
    setError(null);
    try {
      const response = await fetch(`/api/sessions/${pin}/next`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not advance the question.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not advance the question.");
    } finally {
      setIsAdvancing(false);
    }
  }

  async function handleLock() {
    await fetch(`/api/sessions/${pin}/lock`, { method: "POST" }).catch(() => {});
  }

  if (podium) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-8 px-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">🏆 Final Results</h1>
        <ol className="flex w-full flex-col gap-3">
          {podium.map((entry) => (
            <li
              key={entry.playerId}
              className="flex items-center justify-between rounded-lg border border-zinc-200 px-5 py-4 dark:border-zinc-800"
            >
              <span className="text-lg font-medium">
                #{entry.rank} {entry.nickname}
              </span>
              <span className="font-mono text-lg">{entry.points}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (started && question) {
    return (
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center gap-6 px-6 py-16 text-center">
        <p className="text-sm text-zinc-500">
          Question {question.questionIndex + 1} of {questionCount}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{question.question}</h1>
        <p className="font-mono text-5xl font-bold">{remaining}</p>
        <ul className="grid w-full grid-cols-2 gap-3">
          {question.choices.map((choice, index) => (
            <li
              key={index}
              className="rounded-lg px-4 py-3 text-left font-medium text-white"
              style={{ backgroundColor: ANSWER_SHAPES[index % ANSWER_SHAPES.length].color }}
            >
              {choice}
            </li>
          ))}
        </ul>
        <p className="text-lg text-zinc-500">
          {answeredCount} / {playerCount} answered
        </p>

        {locked && leaderboard && (
          <div className="w-full max-w-sm">
            <p className="mb-2 text-sm font-medium text-zinc-500">Leaderboard</p>
            <ol className="flex flex-col gap-2">
              {leaderboard.map((entry) => (
                <li
                  key={entry.playerId}
                  className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
                >
                  <span>
                    #{entry.rank} {entry.nickname}
                  </span>
                  <span className="font-mono">{entry.points}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {locked ? (
          <button
            type="button"
            onClick={handleNext}
            disabled={isAdvancing || isLastQuestion}
            className="rounded-full bg-black px-8 py-3 text-base font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {isLastQuestion ? "Ending game..." : isAdvancing ? "Loading..." : "Next Question"}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleLock}
            className="rounded-full border border-zinc-300 px-8 py-3 text-base font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Lock Now
          </button>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center gap-8 px-6 py-16 text-center">
      <div>
        <p className="text-sm uppercase tracking-widest text-zinc-500">{quizTitle}</p>
        <p className="mt-2 text-sm text-zinc-500">Join at {joinUrl}</p>
      </div>
      <p className="font-mono text-8xl font-bold tracking-widest">{pin}</p>

      {started ? (
        <button
          type="button"
          onClick={handleNext}
          disabled={isAdvancing}
          className="rounded-full bg-black px-8 py-3 text-base font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {isAdvancing ? "Loading..." : "Next Question"}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleStart}
          disabled={players.length === 0 || isStarting}
          className="rounded-full bg-black px-8 py-3 text-base font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {isStarting ? "Starting..." : "Start Game"}
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

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
