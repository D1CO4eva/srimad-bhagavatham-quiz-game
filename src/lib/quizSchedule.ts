export type ScheduleGate = {
  status: "DRAFT" | "PUBLISHED";
  mode: "LIVE" | "SELF_PACED";
  responsesOpen: boolean;
  opensAt: Date | null;
  closesAt: Date | null;
};

export type WindowState = "not_open_yet" | "closed_by_window" | "closed_by_host" | "open";

/** Whether a SELF_PACED quiz currently accepts submissions: published, the
 * host's manual switch is on, and (if a window is set) `now` falls inside it. */
export function isAcceptingResponses(quiz: ScheduleGate, now: Date = new Date()): boolean {
  if (quiz.status !== "PUBLISHED" || quiz.mode !== "SELF_PACED" || !quiz.responsesOpen) return false;
  if (quiz.opensAt && now < quiz.opensAt) return false;
  if (quiz.closesAt && now > quiz.closesAt) return false;
  return true;
}

/** Explains *why* a quiz isn't accepting responses, for the public take-quiz page. */
export function describeWindowState(quiz: ScheduleGate, now: Date = new Date()): WindowState {
  if (!quiz.responsesOpen) return "closed_by_host";
  if (quiz.opensAt && now < quiz.opensAt) return "not_open_yet";
  if (quiz.closesAt && now > quiz.closesAt) return "closed_by_window";
  return "open";
}
