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
  type SettingsUpdatePayload,
} from "@/lib/events";
import { measureLatency } from "@/lib/latency";
import { useCountdown } from "@/lib/useCountdown";
import { ANSWER_SHAPES } from "@/lib/answerShapes";
import { AnswerShapeIcon } from "@/components/AnswerShapeIcon";
import { QuoteOverlay } from "@/components/QuoteOverlay";
import { savePlayerSession } from "@/lib/playerSession";
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
  initialMyChoices,
  initialRevealedAnswers,
  initialShowLeaderboard,
  initialShowTimer,
}: {
  pin: string;
  playerId: string;
  nickname: string;
  initialGameStarted: boolean;
  initialPodium: LeaderboardEntry[] | null;
  initialQuestion: QuestionStartPayload | null;
  initialLocked: boolean;
  initialMyChoices: number[];
  initialRevealedAnswers: string[] | null;
  initialShowLeaderboard: boolean;
  initialShowTimer: boolean;
}) {
  const [gameStarted, setGameStarted] = useState(initialGameStarted);
  const [question, setQuestion] = useState<QuestionStartPayload | null>(initialQuestion);
  const [locked, setLocked] = useState(initialLocked);
  const [revealedAnswers, setRevealedAnswers] = useState<string[] | null>(initialRevealedAnswers);
  // Submitted choices (locks the answer in). Separate from `selectedIndices`
  // below, which tracks in-progress multi-select taps before submission.
  const [myChoices, setMyChoices] = useState<number[]>(initialMyChoices);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [myRank, setMyRank] = useState<{ rank: number; points: number } | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [podium, setPodium] = useState<LeaderboardEntry[] | null>(initialPodium);
  const [showLeaderboard, setShowLeaderboard] = useState(initialShowLeaderboard);
  const [showTimer, setShowTimer] = useState(initialShowTimer);
  const [activeQuote, setActiveQuote] = useState<QuoteDisplayPayload | null>(null);

  const isMultiSelect = question?.type === "MULTI_SELECT";

  const leadDurationSecs =
    question?.startedAt != null && question?.optionsRevealedAt != null
      ? (question.optionsRevealedAt - question.startedAt) / 1000
      : 0;
  const leadRemaining = useCountdown(question?.startedAt ?? null, leadDurationSecs);
  const optionsVisible = question !== null && leadRemaining <= 0;

  const remaining = useCountdown(question?.optionsRevealedAt ?? null, question?.timeLimitSecs ?? 0);

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
      setRevealedAnswers(null);
      setMyChoices([]);
      setSelectedIndices([]);
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
      setRevealedAnswers(data.correctChoices);
    };
    const onLeaderboardUpdate = (message: InboundMessage) => {
      setLeaderboard((message.data as LeaderboardUpdatePayload).leaderboard);
    };
    const onPodium = (message: InboundMessage) => {
      setPodium((message.data as PodiumPayload).podium);
    };
    const onSettingsUpdate = (message: InboundMessage) => {
      const data = message.data as SettingsUpdatePayload;
      setShowLeaderboard(data.showLeaderboard);
      setShowTimer(data.showTimer);
    };

    channel.subscribe(SessionEvent.GameStarted, onGameStarted);
    channel.subscribe(SessionEvent.QuoteDisplay, onQuoteDisplay);
    channel.subscribe(SessionEvent.QuestionStart, onQuestionStart);
    channel.subscribe(SessionEvent.QuestionLocked, onQuestionLocked);
    channel.subscribe(SessionEvent.LeaderboardUpdate, onLeaderboardUpdate);
    channel.subscribe(SessionEvent.Podium, onPodium);
    channel.subscribe(SessionEvent.SettingsUpdate, onSettingsUpdate);

    return () => {
      channel.unsubscribe(SessionEvent.GameStarted, onGameStarted);
      channel.unsubscribe(SessionEvent.QuoteDisplay, onQuoteDisplay);
      channel.unsubscribe(SessionEvent.QuestionStart, onQuestionStart);
      channel.unsubscribe(SessionEvent.QuestionLocked, onQuestionLocked);
      channel.unsubscribe(SessionEvent.LeaderboardUpdate, onLeaderboardUpdate);
      channel.unsubscribe(SessionEvent.Podium, onPodium);
      channel.unsubscribe(SessionEvent.SettingsUpdate, onSettingsUpdate);
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

  async function submitChoices(indices: number[]) {
    if (myChoices.length > 0 || locked || !question || !optionsVisible || indices.length === 0) return;
    setMyChoices(indices);
    setSubmitError(null);
    try {
      const response = await fetch(`/api/sessions/${pin}/answers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, questionId: question.questionId, choiceIndices: indices }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setSubmitError(data.error ?? "Too late — that answer wasn't counted.");
      }
    } catch {
      setSubmitError("Couldn't reach the server — that answer wasn't counted.");
    }
  }

  function toggleSelected(index: number) {
    if (myChoices.length > 0 || locked || !optionsVisible) return;
    setSelectedIndices((current) =>
      current.includes(index) ? current.filter((i) => i !== index) : [...current, index]
    );
  }

  function handleTileClick(index: number) {
    if (isMultiSelect) {
      toggleSelected(index);
    } else {
      submitChoices([index]);
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
    const correctPicks = myChoices.filter(
      (i) => revealedAnswers !== null && revealedAnswers.includes(question.choices[i])
    ).length;
    const isFullyCorrect =
      revealedAnswers !== null && correctPicks === revealedAnswers.length && myChoices.length === revealedAnswers.length;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
        {activeQuote && <QuoteOverlay quote={activeQuote.quote} attribution={activeQuote.attribution} />}
        {showTimer && optionsVisible && <p className="font-serif text-5xl font-bold text-brand">{remaining}</p>}
        <h1 className="max-w-md text-2xl">{question.question}</h1>
        {!optionsVisible ? (
          <p className="pill-badge">Get ready… {leadRemaining}</p>
        ) : myChoices.length > 0 && submitError ? (
          <p className="pill-badge">{submitError}</p>
        ) : myChoices.length > 0 && locked && revealedAnswers !== null ? (
          isFullyCorrect ? (
            <p className="pill-badge bg-success-soft text-success">Correct! ✓</p>
          ) : correctPicks > 0 ? (
            <p className="pill-badge bg-success-soft text-success">
              {correctPicks}/{revealedAnswers.length} correct
            </p>
          ) : (
            <p className="pill-badge bg-danger-soft text-danger">Incorrect ✗</p>
          )
        ) : myChoices.length > 0 ? (
          <p className="pill-badge">Answer locked in!</p>
        ) : locked ? (
          <p className="pill-badge">Time&apos;s up!</p>
        ) : isMultiSelect ? (
          <p className="pill-badge">Select all that apply</p>
        ) : (
          <p className="pill-badge">Tap your answer</p>
        )}
        {optionsVisible && (
          <div className="grid w-full max-w-sm grid-cols-2 gap-4">
            {question.choices.map((choice, index) => {
              const shape = ANSWER_SHAPES[index % ANSWER_SHAPES.length];
              const disabled = myChoices.length > 0 || locked;
              const isRevealed = revealedAnswers !== null;
              const isCorrectChoice = isRevealed && revealedAnswers.includes(choice);
              const isSelectedPreSubmit = isMultiSelect && myChoices.length === 0 && selectedIndices.includes(index);
              const opacityClass = isRevealed ? (isCorrectChoice ? "" : "opacity-30") : disabled ? "opacity-40" : "";
              return (
                <button
                  key={index}
                  type="button"
                  disabled={disabled}
                  onClick={() => handleTileClick(index)}
                  className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl px-3 py-4 text-center text-xl font-semibold text-white shadow-lg transition-all duration-500 ${opacityClass} ${
                    isCorrectChoice ? "ring-4 ring-success" : isSelectedPreSubmit ? "ring-4 ring-white" : ""
                  }`}
                  style={{ backgroundColor: shape.color }}
                  aria-label={shape.label}
                  aria-pressed={isMultiSelect ? isSelectedPreSubmit : undefined}
                >
                  <AnswerShapeIcon label={shape.label} className="h-6 w-6 shrink-0" />
                  <span className="answer-tile-text">{choice}</span>
                </button>
              );
            })}
          </div>
        )}
        {isMultiSelect && optionsVisible && myChoices.length === 0 && (
          <button
            type="button"
            onClick={() => submitChoices(selectedIndices)}
            disabled={selectedIndices.length === 0}
            className="btn btn-primary"
          >
            Submit Answer
          </button>
        )}
        {showLeaderboard && locked && leaderboard && (
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
        {showLeaderboard && locked && myRank && !leaderboard?.some((entry) => entry.playerId === playerId) && (
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
