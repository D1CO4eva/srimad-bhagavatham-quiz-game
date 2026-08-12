"use client";

import { useEffect, useRef, useState } from "react";
import { createSessionRealtimeClient } from "@/lib/ably-client";
import {
  SessionEvent,
  type AnswerCountUpdatePayload,
  type LeaderboardEntry,
  type LeaderboardUpdatePayload,
  type PodiumPayload,
  type QuestionLockedPayload,
  type QuestionStartPayload,
} from "@/lib/events";
import { useCountdown } from "@/lib/useCountdown";
import { ANSWER_SHAPES } from "@/lib/answerShapes";
import type { InboundMessage } from "ably";

type Player = { id: string; nickname: string };

const MEDALS = ["🥇", "🥈", "🥉"];

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
  const [revealedAnswer, setRevealedAnswer] = useState<string | null>(null);
  const [answeredCount, setAnsweredCount] = useState(initialAnsweredCount);
  const [playerCount, setPlayerCount] = useState(initialPlayerCount);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [podium, setPodium] = useState<LeaderboardEntry[] | null>(initialPodium);
  const [isEnding, setIsEnding] = useState(false);

  const liveRemaining = useCountdown(question?.startedAt ?? null, question?.timeLimitSecs ?? 0);
  // Frozen the instant the question locks (captured in the onQuestionLocked
  // handler below), so the displayed number stops instead of continuing to
  // tick down off the wall clock after answering has closed.
  const [frozenRemaining, setFrozenRemaining] = useState<number | null>(null);
  // Kept in sync via effect (not read during render) so the lock handler
  // below can read the latest value without a stale closure.
  const liveRemainingRef = useRef(liveRemaining);
  useEffect(() => {
    liveRemainingRef.current = liveRemaining;
  }, [liveRemaining]);

  const remaining = locked ? (frozenRemaining ?? liveRemaining) : liveRemaining;
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
      setRevealedAnswer(null);
      setFrozenRemaining(null);
      setAnsweredCount(0);
      setLeaderboard(null);
    };
    const onAnswerCountUpdate = (message: InboundMessage) => {
      const data = message.data as AnswerCountUpdatePayload;
      setAnsweredCount(data.answeredCount);
      setPlayerCount(data.playerCount);
    };
    const onQuestionLocked = (message: InboundMessage) => {
      const data = message.data as QuestionLockedPayload;
      setLocked(true);
      setFrozenRemaining(liveRemainingRef.current);
      setRevealedAnswer(data.answer);
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

  async function handleEndGame() {
    if (!window.confirm("End this game for everyone and show the final results?")) return;
    setIsEnding(true);
    setError(null);
    try {
      const response = await fetch(`/api/sessions/${pin}/end`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not end the game.");
      if (data.podium) setPodium(data.podium);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not end the game.");
    } finally {
      setIsEnding(false);
    }
  }

  // Available on every host screen — pin-sharing, mid-question, and podium —
  // so the host is never stuck without a way back to /host. A normal
  // in-flow button at the bottom, not fixed, so it never overlaps content.
  const endGameButton = (
    <button
      type="button"
      onClick={handleEndGame}
      disabled={isEnding}
      className="btn btn-secondary text-danger"
    >
      {isEnding ? "Ending…" : "End Game"}
    </button>
  );

  if (podium) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-8 px-6 text-center">
        <span className="pill-badge">{quizTitle}</span>
        <h1 className="text-5xl">Final Results</h1>
        <ol className="flex w-full flex-col gap-3">
          {podium.map((entry) => (
            <li key={entry.playerId} className="card flex items-center justify-between gap-4 px-6 py-5">
              <span className="flex items-center gap-3 font-serif text-xl text-brand-ink">
                <span className="text-2xl">{MEDALS[entry.rank - 1] ?? `#${entry.rank}`}</span>
                {entry.nickname}
              </span>
              <span className="font-serif text-2xl font-bold text-brand">{entry.points}</span>
            </li>
          ))}
        </ol>
        {error && <p className="text-sm text-danger">{error}</p>}
        {endGameButton}
      </div>
    );
  }

  if (started && question) {
    return (
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center gap-6 px-6 py-16 text-center">
        <span className="pill-badge">
          Question {question.questionIndex + 1} of {questionCount}
        </span>
        <h1 className="max-w-2xl text-4xl">{question.question}</h1>
        <p className="font-serif text-6xl font-bold text-brand">{remaining}</p>
        <ul className="grid w-full grid-cols-2 gap-3">
          {question.choices.map((choice, index) => {
            const isCorrect = revealedAnswer !== null && choice === revealedAnswer;
            const isRevealed = revealedAnswer !== null;
            return (
              <li
                key={index}
                className={`rounded-2xl px-5 py-4 text-left font-semibold text-white shadow-lg transition-all duration-500 ${
                  isRevealed && !isCorrect ? "opacity-30" : ""
                } ${isCorrect ? "ring-4 ring-success" : ""}`}
                style={{ backgroundColor: ANSWER_SHAPES[index % ANSWER_SHAPES.length].color }}
              >
                {choice}
                {isCorrect && <span className="ml-2">✓</span>}
              </li>
            );
          })}
        </ul>
        <p className="pill-badge">
          {answeredCount} / {playerCount} answered
        </p>

        {locked && leaderboard && (
          <div className="w-full max-w-sm">
            <p className="mb-2 text-sm font-bold tracking-wide text-ink-soft uppercase">Top 5</p>
            <ol className="flex flex-col gap-2">
              {leaderboard.map((entry) => (
                <li key={entry.playerId} className="card flex items-center justify-between gap-3 px-5 py-3">
                  <span className="flex items-center gap-3 font-medium text-brand-ink">
                    <span className="w-6 text-lg">{MEDALS[entry.rank - 1] ?? `#${entry.rank}`}</span>
                    {entry.nickname}
                  </span>
                  <span className="font-serif text-lg font-bold text-brand">{entry.points}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {locked ? (
          <button type="button" onClick={handleNext} disabled={isAdvancing || isLastQuestion} className="btn btn-primary">
            {isLastQuestion ? "Ending game…" : isAdvancing ? "Loading…" : "Next Question"}
          </button>
        ) : (
          <button type="button" onClick={handleLock} className="btn btn-secondary">
            Lock Now
          </button>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        {endGameButton}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center gap-8 px-6 py-16 text-center">
      <div>
        <span className="pill-badge">{quizTitle}</span>
        <p className="mt-3 text-sm text-ink-soft">Join at {joinUrl}</p>
      </div>
      <p className="font-serif text-8xl font-bold tracking-widest text-brand">{pin}</p>

      {started ? (
        <button type="button" onClick={handleNext} disabled={isAdvancing} className="btn btn-primary">
          {isAdvancing ? "Loading…" : "Next Question"}
        </button>
      ) : (
        <button type="button" onClick={handleStart} disabled={players.length === 0 || isStarting} className="btn btn-primary">
          {isStarting ? "Starting…" : "Start Game"}
        </button>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="w-full">
        <p className="mb-3 text-sm font-bold tracking-wide text-ink-soft uppercase">
          {players.length} player{players.length === 1 ? "" : "s"} joined
        </p>
        <ul className="flex flex-wrap justify-center gap-2">
          {players.map((player) => (
            <li key={player.id} className="pill-badge">
              {player.nickname}
            </li>
          ))}
        </ul>
      </div>

      {endGameButton}
    </div>
  );
}
