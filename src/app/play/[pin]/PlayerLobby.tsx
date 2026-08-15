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
import { ANSWER_TILE_COLORS } from "@/lib/answerShapes";
import { QuoteOverlay } from "@/components/QuoteOverlay";
import { savePlayerSession } from "@/lib/playerSession";
import { Confetti } from "@/components/Confetti";
import type { InboundMessage } from "ably";

const LATENCY_REFRESH_MS = 45_000;
const MEDALS = ["🥇", "🥈", "🥉"];

type MyRank = { rank: number; points: number; totalPlayers: number; correctCount: number; answeredCount: number };

export function PlayerLobby({
  pin,
  playerId,
  nickname,
  initialGameStarted,
  initialPodium,
  initialTotalPlayers,
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
  initialTotalPlayers: number;
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
  const [myRank, setMyRank] = useState<MyRank | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [podium, setPodium] = useState<LeaderboardEntry[] | null>(initialPodium);
  const [totalPlayers, setTotalPlayers] = useState(initialTotalPlayers);
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
      const data = message.data as PodiumPayload;
      setPodium(data.podium);
      setTotalPlayers(data.totalPlayers);
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
    const total = myRank?.totalPlayers || totalPlayers;
    // "Top X%" — 1-indexed rank over the field, so the winner always reads
    // as top 1% rather than top 0%.
    const topPercent = rank !== undefined && total > 0 ? Math.max(1, Math.round((rank / total) * 100)) : null;
    const scorePct =
      myRank && myRank.answeredCount > 0 ? Math.round((myRank.correctCount / myRank.answeredCount) * 100) : null;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
        <Confetti />
        {activeQuote && <QuoteOverlay quote={activeQuote.quote} attribution={activeQuote.attribution} />}
        <h1 className="text-4xl">Game Over</h1>
        {scorePct !== null && (
          <p className="pill-badge">
            {myRank!.correctCount}/{myRank!.answeredCount} correct &middot; {scorePct}%
          </p>
        )}
        {rank !== undefined && (
          <div className="card flex flex-col items-center gap-2 px-10 py-8">
            {showLeaderboard ? (
              <>
                <span className="text-4xl">{MEDALS[rank - 1] ?? `#${rank}`}</span>
                <p className="font-serif text-2xl text-brand-ink">You placed #{rank}</p>
              </>
            ) : (
              // Leaderboard was off for the last question — standings (and
              // exact point totals, which would let players back into a
              // ranking anyway) stay private; show a percentile instead
              // (Story: percentile when leaderboard is off).
              <p className="font-serif text-2xl text-brand-ink">
                Top {topPercent}% of {total} player{total === 1 ? "" : "s"}
              </p>
            )}
            {showLeaderboard && <p className="font-serif text-3xl font-bold text-brand">{points} pts</p>}
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
        <h1 className="max-w-md text-2xl break-words lg:max-w-xl">{question.question}</h1>
        {!optionsVisible ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs font-bold tracking-wide text-ink-soft uppercase">Get Ready</p>
            <p className="font-serif text-7xl font-bold text-brand">{leadRemaining}</p>
          </div>
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
          <p className="pill-badge">{showTimer ? "Time's up!" : "Locked!"}</p>
        ) : isMultiSelect ? (
          <p className="pill-badge">Select all that apply</p>
        ) : (
          <p className="pill-badge">Tap your answer</p>
        )}
        {/* Always mounted at full size (even before options reveal) and just
            toggled invisible, rather than conditionally mounted — so reveal
            never changes this screen's total height and re-triggers the
            surrounding flex column's justify-center recentering, which used
            to visibly jerk the question up the moment choices appeared. */}
        <div
          className={`grid w-full max-w-sm grid-cols-2 gap-4 lg:max-w-xl ${optionsVisible ? "" : "invisible"}`}
          aria-hidden={!optionsVisible}
        >
          {question.choices.map((choice, index) => {
            const disabled = myChoices.length > 0 || locked;
            const isRevealed = revealedAnswers !== null;
            const isCorrectChoice = isRevealed && revealedAnswers.includes(choice);
            const mySelected = isMultiSelect
              ? myChoices.length > 0
                ? myChoices.includes(index)
                : selectedIndices.includes(index)
              : myChoices.includes(index);
            // My own pick that turned out wrong, once the answer's revealed
            // (Show what the player selected when the question locks: ✓ on
            // the correct tile, ✗ on their own wrong pick).
            const isMyWrongPick = isRevealed && mySelected && !isCorrectChoice;
            const dimClass = isRevealed
              ? isCorrectChoice || isMyWrongPick
                ? ""
                : "opacity-30"
              : disabled && !mySelected
                ? "opacity-40"
                : "";
            const ringClass = isCorrectChoice
              ? "ring-4 ring-success"
              : isMyWrongPick
                ? "ring-4 ring-danger"
                : mySelected && !isRevealed
                  ? "ring-4 ring-white"
                  : "";
            return (
              <button
                key={index}
                type="button"
                disabled={disabled}
                onClick={() => handleTileClick(index)}
                className={`flex min-h-24 min-w-0 flex-col items-center justify-center gap-2 rounded-2xl px-3 py-4 text-center text-xl font-semibold text-white shadow-lg transition-all duration-500 ${dimClass} ${ringClass}`}
                style={{ backgroundColor: ANSWER_TILE_COLORS[index % ANSWER_TILE_COLORS.length] }}
                aria-label={`Option ${index + 1}: ${choice}`}
                aria-pressed={isMultiSelect ? mySelected : undefined}
              >
                <span className="answer-tile-text min-w-0 break-words">{choice}</span>
                {isCorrectChoice && <span>✓</span>}
                {isMyWrongPick && <span>✗</span>}
              </button>
            );
          })}
        </div>
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
          <div className="w-full max-w-sm lg:max-w-md">
            <p className="mb-2 text-sm font-bold tracking-wide text-ink-soft uppercase">Top 10</p>
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
