"use client";

import { useState } from "react";

type Period = "AM" | "PM";
type Step = "dates" | "times";
type Slot = "start" | "end";

type TimeParts = { hour: number; minute: number; period: Period };

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sameDay(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDateLabel(date: Date | null): string {
  if (!date) return "Not set";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function combineDateAndTime(date: Date, time: TimeParts): Date {
  let hour24 = time.hour % 12;
  if (time.period === "PM") hour24 += 12;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour24, time.minute, 0, 0);
}

function splitDateToTime(date: Date): TimeParts {
  const hour24 = date.getHours();
  const period: Period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return { hour: hour12, minute: date.getMinutes(), period };
}

function monthGridCells(viewMonth: Date): (Date | null)[] {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));
  return cells;
}

const DEFAULT_START_TIME: TimeParts = { hour: 9, minute: 0, period: "AM" };
const DEFAULT_END_TIME: TimeParts = { hour: 11, minute: 59, period: "PM" };

export function ScheduleWindowPicker({
  quizId,
  initialOpensAt,
  initialClosesAt,
  onSaved,
}: {
  quizId: string;
  initialOpensAt: string | null;
  initialClosesAt: string | null;
  onSaved?: (next: { opensAt: string | null; closesAt: string | null }) => void;
}) {
  const initialStart = initialOpensAt ? new Date(initialOpensAt) : null;
  const initialEnd = initialClosesAt ? new Date(initialClosesAt) : null;

  const [expanded, setExpanded] = useState(false);
  const [step, setStep] = useState<Step>("dates");
  const [pickingSlot, setPickingSlot] = useState<Slot>(initialStart ? "end" : "start");
  const [startDate, setStartDate] = useState<Date | null>(initialStart ? startOfDay(initialStart) : null);
  const [endDate, setEndDate] = useState<Date | null>(initialEnd ? startOfDay(initialEnd) : null);
  const [startTime, setStartTime] = useState<TimeParts>(initialStart ? splitDateToTime(initialStart) : DEFAULT_START_TIME);
  const [endTime, setEndTime] = useState<TimeParts>(initialEnd ? splitDateToTime(initialEnd) : DEFAULT_END_TIME);
  const [viewMonth, setViewMonth] = useState<Date>(startOfDay(initialStart ?? new Date()));
  const [dateError, setDateError] = useState<string | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const hasWindow = Boolean(initialOpensAt || initialClosesAt);

  function handleDayClick(day: Date) {
    setDateError(null);
    if (pickingSlot === "start") {
      setStartDate(day);
      if (endDate && day > endDate) setEndDate(null);
      setPickingSlot("end");
      return;
    }
    if (startDate && day < startDate) {
      setDateError("End date must be on or after the start date.");
      return;
    }
    setEndDate(day);
  }

  function editSlot(slot: Slot) {
    setDateError(null);
    if (slot === "start") setStartDate(null);
    else setEndDate(null);
    setPickingSlot(slot);
    setStep("dates");
  }

  function changeMonth(delta: number) {
    setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  function validateTime(time: TimeParts, isEnd: boolean): string | null {
    if (!Number.isInteger(time.hour) || time.hour < 1 || time.hour > 12) return "Hour must be between 1 and 12.";
    if (!Number.isInteger(time.minute) || time.minute < 0 || time.minute > 59) return "Minute must be between 0 and 59.";
    if (isEnd && time.hour === 12 && time.minute === 0 && time.period === "AM") {
      return "End time can't be 12:00 AM — the latest allowed time is 11:59 PM.";
    }
    return null;
  }

  function handleNext() {
    if (!startDate || !endDate) return;
    setStep("times");
  }

  async function handleSave() {
    if (!startDate || !endDate) return;
    const startErr = validateTime(startTime, false);
    const endErr = validateTime(endTime, true);
    if (startErr || endErr) {
      setTimeError(startErr ?? endErr);
      return;
    }
    const opens = combineDateAndTime(startDate, startTime);
    const closes = combineDateAndTime(endDate, endTime);
    if (closes <= opens) {
      setTimeError("The end date/time must be after the start date/time.");
      return;
    }
    setTimeError(null);
    setSaveError(null);
    setIsSaving(true);
    try {
      const response = await fetch(`/api/quizzes/${quizId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opensAt: opens.toISOString(), closesAt: closes.toISOString() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save the response window.");
      onSaved?.({ opensAt: data.opensAt, closesAt: data.closesAt });
      setExpanded(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save the response window.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleClear() {
    setSaveError(null);
    setIsSaving(true);
    try {
      const response = await fetch(`/api/quizzes/${quizId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opensAt: null, closesAt: null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not clear the response window.");
      onSaved?.({ opensAt: null, closesAt: null });
      setStartDate(null);
      setEndDate(null);
      setPickingSlot("start");
      setStep("dates");
      setExpanded(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not clear the response window.");
    } finally {
      setIsSaving(false);
    }
  }

  function timeRow(label: string, time: TimeParts, setTime: (t: TimeParts) => void, isEnd: boolean) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="w-20 font-semibold text-ink-soft">{label}</span>
        <input
          type="number"
          min={1}
          max={12}
          value={time.hour}
          onChange={(event) => setTime({ ...time, hour: Number(event.target.value) })}
          className="input-field w-16 py-1 text-center"
          aria-label={`${label} hour`}
        />
        <span>:</span>
        <input
          type="number"
          min={0}
          max={59}
          value={String(time.minute).padStart(2, "0")}
          onChange={(event) => setTime({ ...time, minute: Number(event.target.value) })}
          className="input-field w-16 py-1 text-center"
          aria-label={`${label} minute`}
        />
        <div className="flex overflow-hidden rounded-full border border-line">
          {(["AM", "PM"] as const).map((period) => (
            <button
              key={period}
              type="button"
              onClick={() => setTime({ ...time, period })}
              className={`px-3 py-1 text-xs font-bold ${
                time.period === period ? "bg-brand text-white" : "bg-white text-ink-soft"
              }`}
            >
              {period}
            </button>
          ))}
        </div>
        {isEnd && <span className="text-xs text-ink-soft">(latest 11:59 PM)</span>}
      </div>
    );
  }

  if (!expanded) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-soft">
          Response window:{" "}
          {hasWindow ? (
            <span className="font-semibold text-ink">
              {formatDateLabel(initialStart)} – {formatDateLabel(initialEnd)}
            </span>
          ) : (
            "Not set (open based on the toggle alone)"
          )}
        </span>
        <button type="button" onClick={() => setExpanded(true)} className="text-sm font-semibold text-brand-ink underline">
          {hasWindow ? "Edit window" : "Set a window"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="pill-badge">
          Start: {formatDateLabel(startDate)}
          {startDate && (
            <button type="button" onClick={() => editSlot("start")} className="ml-1 underline">
              Edit
            </button>
          )}
        </div>
        <div className="pill-badge">
          End: {formatDateLabel(endDate)}
          {endDate && (
            <button type="button" onClick={() => editSlot("end")} className="ml-1 underline">
              Edit
            </button>
          )}
        </div>
        <button type="button" onClick={() => setExpanded(false)} className="ml-auto text-xs font-semibold text-ink-soft underline">
          Close
        </button>
      </div>

      {step === "dates" && (
        <div>
          <p className="mb-2 text-xs font-semibold text-ink-soft">
            {pickingSlot === "start" ? "Pick the start date" : "Pick the end date"}
          </p>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => changeMonth(-1)} className="btn btn-secondary px-3 py-1">
              ‹
            </button>
            <span className="font-semibold text-ink">
              {MONTH_LABELS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
            </span>
            <button type="button" onClick={() => changeMonth(1)} className="btn btn-secondary px-3 py-1">
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label} className="py-1 font-semibold text-ink-soft">
                {label}
              </span>
            ))}
            {monthGridCells(viewMonth).map((day, index) => {
              if (!day) return <span key={`empty-${index}`} />;
              const isStart = sameDay(day, startDate);
              const isEnd = sameDay(day, endDate);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => handleDayClick(day)}
                  className={`rounded-full py-1.5 ${
                    isStart || isEnd ? "bg-brand text-white" : "text-ink hover:bg-paper-deep"
                  }`}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
          {dateError && <p className="mt-2 text-xs text-danger">{dateError}</p>}
          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={handleNext} disabled={!startDate || !endDate} className="btn btn-primary">
              Next: set times
            </button>
            {hasWindow && (
              <button type="button" onClick={handleClear} disabled={isSaving} className="text-xs font-semibold text-danger underline">
                Clear window
              </button>
            )}
          </div>
        </div>
      )}

      {step === "times" && (
        <div className="flex flex-col gap-3">
          <button type="button" onClick={() => setStep("dates")} className="self-start text-xs font-semibold text-brand-ink underline">
            ‹ Back to dates
          </button>
          {timeRow("Start time", startTime, setStartTime, false)}
          {timeRow("End time", endTime, setEndTime, true)}
          {timeError && <p className="text-xs text-danger">{timeError}</p>}
          <div className="flex items-center gap-3">
            <button type="button" onClick={handleSave} disabled={isSaving} className="btn btn-primary">
              {isSaving ? "Saving…" : "Save window"}
            </button>
            {hasWindow && (
              <button type="button" onClick={handleClear} disabled={isSaving} className="text-xs font-semibold text-danger underline">
                Clear window
              </button>
            )}
          </div>
        </div>
      )}

      {saveError && <p className="text-xs text-danger">{saveError}</p>}
    </div>
  );
}
