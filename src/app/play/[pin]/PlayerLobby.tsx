"use client";

import { useEffect, useState } from "react";
import { createSessionRealtimeClient } from "@/lib/ably-client";
import {
  SessionEvent,
  type LeaderboardEntry,
  type LeaderboardUpdatePayload,
  type PodiumPayload,
  type QuestionLockedPayload,
  type QuestionStartPayload,
  type QuoteDisplayPayload,
} from "@/lib/events";
import { measureLatency } from "@/lib/latency";
import { useCountdown } from "@/lib/useCountdown";
import { ANSWER_SHAPES } from "@/lib/answerShapes";
import { savePlayerSession } from "@/lib/playerSession";
import { QuoteOverlay } from "@/components/QuoteOverlay";
import type { InboundMessage } from "ably";

const LATENCY_REFRESH_MS = 45_000;
const MEDALS = ["🥇", "🥈", "🥉"];

export function PlayerLobby({
  pin,
  playerId,
  nickname,
  initialGameStarted,
  initialPodium,
  initialQuestion,
  initialLocked,
  initialMyChoice,
  initialRevealedAnswer,
}: {
  pin: string;
  playerId: string;
  nickname: string;
  initialGameStarted: boolean;
  initialPodium: LeaderboardEntry[] | null;
  initialQuestion: QuestionStartPayload | null;
  initialLocked: boolean;
  initialMyChoice: number | null;
  initialRevealedAnswer: string | null;
}) {
  const [gameStarted, setGameStarted] = useState(initialGameStarted);
  const [question, setQuestion] = useState<QuestionStartPayload | null>(initialQuestion);
  const [locked, setLocked] = useState(initialLocked);
  const [revealedAnswer, setRevealedAnswer] = useState<string | null>(initialRevealedAnswer);
  const [myChoice, setMyChoice] = useState<number | null>(initialMyChoice);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [myRank, setMyRank] = useState<{ rank: number; points: number } | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [podium, setPodium] = useState<LeaderboardEntry[] | null>(initialPodium);
  const [activeQuote, setActiveQuote] = useState<QuoteDisplayPayload | null>(null);

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
      setRevealedAnswer(null);
      setMyChoice(null);
      setSubmitError(null);
      setMyRank(null);
      setLeaderboard(null);
      setActiveQuote(null);
    };
    const onQuoteDisplay = (message: InboundMessage) => {
      setActiveQuote(message.data as QuoteDisplayPayload);
    };
    const onQuestionLocked = (message: InboundMessage) => {
      const data = message.data as QuestionLockedPayload;
      setLocked(true);
      setRevealedAnswer(data.answer);
    };
    const onLeaderboardUpdate = (message: InboundMessage) => {
      setLeaderboard((message.data as LeaderboardUpdatePayload).leaderboard);
    };
    const onPodium = (message: InboundMessage) => {
      setPodium((message.data as PodiumPayload).podium);
    };

    channel.subscribe(SessionEvent.GameStarted, onGameStarted);
    channel.subscribe(SessionEvent.QuoteDisplay, onQuoteDisplay);
    channel.subscribe(SessionEvent.QuestionStart, onQuestionStart);
    channel.subscribe(SessionEvent.QuestionLocked, onQuestionLocked);
    channel.subscribe(SessionEvent.LeaderboardUpdate, onLeaderboardUpdate);
    channel.subscribe(SessionEvent.Podium, onPodium);

    return () => {
      channel.unsubscribe(SessionEvent.GameStarted, onGameStarted);
      channel.unsubscribe(SessionEvent.QuoteDisplay, onQuoteDisplay);
      channel.unsubscribe(SessionEvent.QuestionStart, onQuestionStart);
      channel.unsubscribe(SessionEvent.QuestionLocked, onQuestionLocked);
      channel.unsubscribe(SessionEvent.LeaderboardUpdate, onLeaderboardUpdate);
      channel.unsubscribe(SessionEvent.Podium, onPodium);
      client.close();
    };
  }, [pin, playerId]);

  // Safety-net auto-clear matching the server's own wait (questions.ts sleeps
  // for the same displayMs before broadcasting question_start) — covers the
  // case where that broadcast is ever delayed or dropped.
  useEffect(() => {
    if (!activeQuote) return;
    const timer = setTimeout(() => setActiveQuote(null), activeQuote.displayMs);
    return () => clearTimeout(timer);
  }, [activeQuote]);

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
    const rank = mine?.rank ?? myRank?.rank;
    const points = mine?.points ?? myRank?.points;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
        {activeQuote && <QuoteOverlay quote={activeQuote.quote} attribution={activeQuote.attribution} />}
        <h1 className="text-4xl">Game Over</h1>
        {rank !== undefined && (
          <div className="card flex flex-col items-center gap-2 px-10 py-8">
            <span className="text-4xl">{MEDALS[rank - 1] ?? `#${rank}`}</span>
            <p className="font-serif text-2xl text-brand-ink">
              You placed #{rank}
            </p>
            <p className="font-serif text-3xl font-bold text-brand">{points} pts</p>
          </div>
        )}
      </div>
    );
  }

  if (question) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
        {activeQuote && <QuoteOverlay quote={activeQuote.quote} attribution={activeQuote.attribution} />}
        <p className="font-serif text-5xl font-bold text-brand">{remaining}</p>
        {myChoice !== null && submitError ? (
          <p className="pill-badge">{submitError}</p>
        ) : myChoice !== null && locked && revealedAnswer !== null ? (
          question.choices[myChoice] === revealedAnswer ? (
            <p className="pill-badge bg-success-soft text-success">Correct! ✓</p>
          ) : (
            <p className="pill-badge bg-danger-soft text-danger">Incorrect ✗</p>
          )
        ) : myChoice !== null ? (
          <p className="pill-badge">Answer locked in!</p>
        ) : locked ? (
          <p className="pill-badge">Time&apos;s up!</p>
        ) : (
          <p className="pill-badge">Tap your answer</p>
        )}
        <div className="grid w-full max-w-sm grid-cols-2 gap-4">
          {question.choices.map((choice, index) => {
            const shape = ANSWER_SHAPES[index % ANSWER_SHAPES.length];
            const disabled = myChoice !== null || locked;
            const isRevealed = revealedAnswer !== null;
            const isCorrectChoice = isRevealed && choice === revealedAnswer;
            const opacityClass = isRevealed ? (isCorrectChoice ? "" : "opacity-30") : disabled ? "opacity-40" : "";
            return (
              <button
                key={index}
                type="button"
                disabled={disabled}
                onClick={() => handleAnswer(index)}
                className={`aspect-square rounded-2xl text-white shadow-lg transition-all duration-500 ${opacityClass} ${
                  isCorrectChoice ? "ring-4 ring-success" : ""
                }`}
                style={{ backgroundColor: shape.color }}
                aria-label={shape.label}
              />
            );
          })}
        </div>
        {locked && leaderboard && (
          <div className="w-full max-w-sm">
            <p className="mb-2 text-sm font-bold tracking-wide text-ink-soft uppercase">Top 5</p>
            <ol className="flex flex-col gap-2">
              {leaderboard.map((entry) => (
                <li
                  key={entry.playerId}
                  className={`card flex items-center justify-between gap-3 px-5 py-3 ${
                    entry.playerId === playerId ? "ring-2 ring-brand" : ""
                  }`}
                >
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
        {locked && myRank && !leaderboard?.some((entry) => entry.playerId === playerId) && (
          <p className="pill-badge">
            Your rank: #{myRank.rank} &middot; {myRank.points} points
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      {activeQuote && <QuoteOverlay quote={activeQuote.quote} attribution={activeQuote.attribution} />}
      <p className="font-serif text-2xl text-brand-ink">Hi, {nickname}!</p>
      {gameStarted ? (
        <p className="text-ink-soft">Game in progress — waiting for the next question…</p>
      ) : (
        <>
          <div
            className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand"
            aria-hidden
          />
          <p className="text-ink-soft">Waiting for the host to start the game…</p>
        </>
      )}
    </div>
  );
}
