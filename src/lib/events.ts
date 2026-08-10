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
