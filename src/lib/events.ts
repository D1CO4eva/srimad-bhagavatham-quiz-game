/**
 * Event names published on a session's Ably channel (`game:{pin}`). Central
 * list so producers (API routes) and consumers (host/player UI) agree on
 * spelling; individual features add payload types as they land.
 */
export const SessionEvent = {
  PlayerJoined: "player_joined",
  GameStarted: "game_started",
  QuoteDisplay: "quote_display",
  QuestionStart: "question_start",
  AnswerCountUpdate: "answer_count_update",
  QuestionLocked: "question_locked",
  LeaderboardUpdate: "leaderboard_update",
  Podium: "podium",
  SettingsUpdate: "settings_update",
  AnswerBreakdown: "answer_breakdown",
} as const;

export type SessionEventName = (typeof SessionEvent)[keyof typeof SessionEvent];

/** Payload for SessionEvent.QuestionStart. Sent to host and players alike —
 * player UI just chooses not to render `question`/`choices` as text (Story 3.2). */
export type QuestionStartPayload = {
  questionId: string;
  questionIndex: number;
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER" | "MULTI_SELECT";
  question: string;
  choices: string[];
  timeLimitSecs: number;
  startedAt: number | null;
  /** Answer choices stay hidden/disabled until this moment (lead-time reveal). */
  optionsRevealedAt: number | null;
};

/** Sent right before question_start when the upcoming question has a quote
 * assigned (see src/lib/swamijiQuotes.ts) — `displayMs` tells clients how
 * long to hold it up before question_start replaces it. */
export type QuoteDisplayPayload = { quote: string; attribution: string; displayMs: number };

export type AnswerCountUpdatePayload = { answeredCount: number; playerCount: number };
/** `correctChoices` are the correct choice text(s) — safe to reveal now that answering is closed. */
export type QuestionLockedPayload = { questionId: string; correctChoices: string[] };

export type LeaderboardEntry = { playerId: string; nickname: string; points: number; rank: number };
export type LeaderboardUpdatePayload = { leaderboard: LeaderboardEntry[] };
/** `totalPlayers` and `showLeaderboard` (the setting's value as of the last
 * question) let clients show a percentile instead of a raw rank when the
 * leaderboard was toggled off (Story: percentile when leaderboard is off). */
export type PodiumPayload = { podium: LeaderboardEntry[]; totalPlayers: number; showLeaderboard: boolean };

/** Broadcast whenever the host flips a live setting mid-game (Story: game settings toggles). */
export type SettingsUpdatePayload = { showLeaderboard: boolean; showTimer: boolean };

/** Broadcast alongside QuestionLocked — how many answered correctly vs
 * incorrectly (host-only chart), plus a per-choice tally in the same order
 * as the question's choices (host-only "answers by choice" bar graph). */
export type AnswerBreakdownPayload = { correctCount: number; incorrectCount: number; choiceCounts: number[] };
