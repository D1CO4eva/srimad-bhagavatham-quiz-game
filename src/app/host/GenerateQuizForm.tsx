"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { PublicCourseWeek } from "@/lib/courseCatalog";
import type { GenerationProgress } from "@/lib/localQuizGenerator";
import { extractSseFrames, parseSseFrame } from "@/lib/sse";

const QUESTION_COUNTS = [5, 8, 10, 15, 20, 25, 30, 35] as const;
const DIFFICULTIES = [
  { label: "Mixed", value: "mixed" },
  { label: "Foundations", value: "beginner" },
  { label: "Discussion", value: "intermediate" },
  { label: "Challenge", value: "advanced" },
] as const;

function progressLabel(progress: GenerationProgress | null): string {
  if (!progress) return "Generating…";
  if (progress.phase === "draft") return `Generating… ${progress.completed} of ${progress.total} questions`;
  if (progress.phase === "repairing") return "Fixing up a few questions…";
  return "Double-checking against the source material…";
}

export function GenerateQuizForm({ weeks }: { weeks: PublicCourseWeek[] }) {
  const router = useRouter();
  const [coverageMode, setCoverageMode] = useState<"single" | "multiple">("single");
  const [selectedWeekIds, setSelectedWeekIds] = useState<string[]>(weeks[0] ? [weeks[0].id] : []);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [questionCount, setQuestionCount] = useState<number>(8);
  const [difficulty, setDifficulty] = useState<string>("mixed");
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const topicOptions = useMemo(() => {
    const selectedWeeks = weeks.filter((week) => selectedWeekIds.includes(week.id));
    const seen = new Set<string>();
    const topics: string[] = [];
    for (const week of selectedWeeks) {
      for (const t of week.topics) {
        if (!seen.has(t)) {
          seen.add(t);
          topics.push(t);
        }
      }
    }
    return topics;
  }, [weeks, selectedWeekIds]);

  function handleCoverageModeChange(mode: "single" | "multiple") {
    setCoverageMode(mode);
    if (mode === "single" && selectedWeekIds.length > 1) {
      setSelectedWeekIds(selectedWeekIds.slice(0, 1));
    }
  }

  function toggleWeek(weekId: string, checked: boolean) {
    setSelectedTopics([]);
    if (coverageMode === "single") {
      setSelectedWeekIds([weekId]);
      return;
    }
    setSelectedWeekIds((current) => {
      if (checked) return [...current, weekId];
      const next = current.filter((id) => id !== weekId);
      return next.length > 0 ? next : current;
    });
  }

  function toggleTopic(topic: string, checked: boolean) {
    setSelectedTopics((current) => (checked ? [...current, topic] : current.filter((t) => t !== topic)));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (selectedWeekIds.length === 0) {
      setError("Select at least one class week.");
      return;
    }
    setIsGenerating(true);
    setProgress(null);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/quizzes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekIds: selectedWeekIds,
          topics: selectedTopics,
          questionCount,
          difficulty,
        }),
      });

      // Validation/catalog failures come back as a plain JSON error before
      // the response ever upgrades to an event stream (see route.ts).
      if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not generate a quiz.");
      }
      if (!response.body) throw new Error("Could not generate a quiz.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: { title: string; questions: unknown[] } | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const { frames, rest } = extractSseFrames(buffer);
        buffer = rest;
        for (const frame of frames) {
          const parsed = parseSseFrame(frame);
          if (!parsed) continue; // heartbeat comment

          if (parsed.event === "progress") {
            setProgress(parsed.data as GenerationProgress);
          } else if (parsed.event === "complete") {
            result = parsed.data as { title: string; questions: unknown[] };
          } else if (parsed.event === "error") {
            throw new Error((parsed.data as { error?: string }).error ?? "Could not generate a quiz.");
          }
        }
      }

      if (!result) throw new Error("Quiz generator's stream ended without a result.");
      setNotice(`Generated "${result.title}" with ${result.questions.length} questions — review it below and publish when ready.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate a quiz.");
    } finally {
      setIsGenerating(false);
      setProgress(null);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card flex flex-col gap-4 p-6">
      <div>
        <p className="font-serif text-xl text-brand-ink">Generate a new quiz</p>
        <p className="text-sm text-ink-soft">
          Source-grounded from the Bhagavatam course notes — every question is checked against the
          material it was generated from before it comes back.
        </p>
      </div>

      <label className="flex flex-col gap-1 text-sm font-semibold text-ink-soft">
        Quiz coverage
        <select
          value={coverageMode}
          onChange={(event) => handleCoverageModeChange(event.target.value as "single" | "multiple")}
          className="input-field"
        >
          <option value="single">One class week</option>
          <option value="multiple">Multiple class weeks</option>
        </select>
      </label>

      {coverageMode === "single" ? (
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink-soft">
          Class week
          <select
            value={selectedWeekIds[0] ?? ""}
            onChange={(event) => toggleWeek(event.target.value, true)}
            className="input-field"
          >
            {weeks.map((week) => (
              <option key={week.id} value={week.id}>
                {week.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <fieldset className="flex flex-col gap-2 text-sm font-semibold text-ink-soft">
          <legend className="mb-1">Class weeks</legend>
          <div className="flex flex-wrap gap-3">
            {weeks.map((week) => (
              <label key={week.id} className="flex items-center gap-2 font-normal text-ink">
                <input
                  type="checkbox"
                  checked={selectedWeekIds.includes(week.id)}
                  onChange={(event) => toggleWeek(week.id, event.target.checked)}
                />
                {week.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="flex flex-col gap-2 text-sm font-semibold text-ink-soft">
        <legend className="mb-1">Topics</legend>
        <label className="flex items-center gap-2 font-normal text-ink">
          <input
            type="checkbox"
            checked={selectedTopics.length === 0}
            onChange={() => setSelectedTopics([])}
          />
          All topics in {coverageMode === "single" ? "this week" : "these weeks"}
        </label>
        <div className="flex flex-wrap gap-3">
          {topicOptions.map((t) => (
            <label key={t} className="flex items-center gap-2 font-normal text-ink">
              <input
                type="checkbox"
                checked={selectedTopics.includes(t)}
                onChange={(event) => toggleTopic(t, event.target.checked)}
              />
              {t}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink-soft">
          Questions
          <select
            value={questionCount}
            onChange={(event) => setQuestionCount(Number(event.target.value))}
            className="input-field"
          >
            {QUESTION_COUNTS.map((count) => (
              <option key={count} value={count}>
                {count} questions
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink-soft">
          Difficulty
          <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)} className="input-field">
            {DIFFICULTIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button type="submit" disabled={isGenerating} className="btn btn-primary self-start">
        {isGenerating ? progressLabel(progress) : "Generate Quiz"}
      </button>
      {error && <p className="text-sm text-danger">{error}</p>}
      {notice && <p className="text-sm font-semibold text-success">{notice}</p>}
    </form>
  );
}
