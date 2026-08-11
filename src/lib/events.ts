/**
 * Event names published on a session's Ably channel (`game:{pin}`). Central
 * list so producers (API routes) and consumers (host/player UI) agree on
 * spelling; individual features add payload types as they land.
 */
export const SessionEvent = {
  PlayerJoined: "player_joined",
  GameStarted: "game_started",
  QuestionStart: "question_start",
  AnswerCountUpdate: "answer_count_update",
  QuestionLocked: "question_locked",
  LeaderboardUpdate: "leaderboard_update",
  Podium: "podium",
} as const;

export type SessionEventName = (typeof SessionEvent)[keyof typeof SessionEvent];

/** Payload for SessionEvent.QuestionStart. Sent to host and players alike —
 * player UI just chooses not to render `question`/`choices` as text (Story 3.2). */
export type QuestionStartPayload = {
  questionId: string;
  questionIndex: number;
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER";
  question: string;
  choices: string[];
  timeLimitSecs: number;
  startedAt: number | null;
};

export type AnswerCountUpdatePayload = { answeredCount: number; playerCount: number };
/** `answer` is the correct choice's text — safe to reveal now that answering is closed. */
export type QuestionLockedPayload = { questionId: string; answer: string };

export type LeaderboardEntry = { playerId: string; nickname: string; points: number; rank: number };
export type LeaderboardUpdatePayload = { leaderboard: LeaderboardEntry[] };
export type PodiumPayload = { podium: LeaderboardEntry[] };
