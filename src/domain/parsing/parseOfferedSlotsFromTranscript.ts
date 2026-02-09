import { DateTime } from "luxon";

export type OfferedSlot = { start: DateTime; end: DateTime };

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
};

const WEEKDAYS: Record<string, number> = {
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
  sun: 7,
  sunday: 7
};

function to24h(hour: number, mer: "am" | "pm"): number {
  if (mer === "am") return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

function nextWeekday(now: DateTime, weekday: number, forceNextWeek: boolean): DateTime {
  let daysAhead = (weekday + 7 - now.weekday) % 7;
  if (daysAhead === 0) daysAhead = 7;
  if (forceNextWeek && daysAhead < 7) daysAhead += 7;
  return now.plus({ days: daysAhead }).startOf("day");
}

function normalizeMer(mer: string | undefined): "am" | "pm" | undefined {
  const m = (mer ?? "").trim().toLowerCase();
  if (m === "am" || m === "a.m." || m === "a") return "am";
  if (m === "pm" || m === "p.m." || m === "p") return "pm";
  return undefined;
}

function coerceYear(now: DateTime, month: number, day: number): number {
  // If a month/day has already passed in the current year, schedule into next year.
  // (We only need a safe, small heuristic for MVP.)
  const candidate = DateTime.fromObject({ year: now.year, month, day }, { zone: now.zone });
  if (!candidate.isValid) return now.year;
  if (candidate < now.minus({ days: 1 })) return now.year + 1;
  return now.year;
}

function addUnique(slots: OfferedSlot[], slot: OfferedSlot): void {
  const key = slot.start.toISO();
  if (!key) return;
  if (slots.some((s) => s.start.toISO() === key)) return;
  slots.push(slot);
}

export type ParseOfferedSlotsOpts = {
  now: DateTime;
  defaultDurationMinutes: number;
  maxSlots?: number;
};

/**
 * Rule-based extraction of offered appointment times from a voice transcript.
 *
 * Goal: be predictable and debuggable for Phase 1. This intentionally prefers
 * concrete patterns over an LLM "black box".
 *
 * Supported patterns (examples):
 * - "Tuesday at 3:30" / "next Thursday 4:15pm"
 * - "Feb 12 at 3:30pm" / "February 12 3:30"
 * - "2/12 3:30"
 */
export function parseOfferedSlotsFromTranscript(
  transcript: string,
  opts: ParseOfferedSlotsOpts
): OfferedSlot[] {
  const maxSlots = opts.maxSlots ?? 3;
  const text = transcript.trim();
  if (!text) return [];

  const now = opts.now;
  const defaultDurationMinutes = opts.defaultDurationMinutes;

  const globalNextWeek = /\bnext\s+week\b/i.test(text);
  const slots: OfferedSlot[] = [];

  // Month name + day + time, e.g. "Feb 12 3:30pm"
  const monthRe =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b[^0-9]{0,12}(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
  for (const m of text.matchAll(monthRe)) {
    const monthToken = (m[1] ?? "").toLowerCase();
    const month = MONTHS[monthToken.replace(/[^a-z]/g, "")];
    const day = Number(m[2]);
    const hour12 = Number(m[3]);
    const minute = m[4] ? Number(m[4]) : 0;
    if (!month || !Number.isFinite(day) || !Number.isFinite(hour12) || !Number.isFinite(minute)) continue;
    const mer = normalizeMer(m[5]) ?? "pm"; // MVP: default PM if ambiguous
    const hour = to24h(hour12, mer);
    const year = coerceYear(now, month, day);
    const start = DateTime.fromObject(
      { year, month, day, hour, minute, second: 0, millisecond: 0 },
      { zone: now.zone }
    );
    if (!start.isValid) continue;
    addUnique(slots, { start, end: start.plus({ minutes: defaultDurationMinutes }) });
    if (slots.length >= maxSlots) return slots.slice(0, maxSlots);
  }

  // Numeric date + time, e.g. "2/12 3:30pm"
  const numericRe =
    /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b[^0-9]{0,12}(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
  for (const m of text.matchAll(numericRe)) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    const yearRaw = m[3] ? Number(m[3]) : undefined;
    const hour12 = Number(m[4]);
    const minute = m[5] ? Number(m[5]) : 0;
    if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(hour12) || !Number.isFinite(minute)) continue;
    const mer = normalizeMer(m[6]) ?? "pm";
    const hour = to24h(hour12, mer);
    const year =
      yearRaw && Number.isFinite(yearRaw)
        ? (yearRaw < 100 ? 2000 + yearRaw : yearRaw)
        : coerceYear(now, month, day);
    const start = DateTime.fromObject(
      { year, month, day, hour, minute, second: 0, millisecond: 0 },
      { zone: now.zone }
    );
    if (!start.isValid) continue;
    addUnique(slots, { start, end: start.plus({ minutes: defaultDurationMinutes }) });
    if (slots.length >= maxSlots) return slots.slice(0, maxSlots);
  }

  // Weekday + time, e.g. "Tuesday at 3:30"
  const weekdayRe =
    /\b(next\s+)?(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b[^0-9]{0,12}(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
  for (const m of text.matchAll(weekdayRe)) {
    const hasNext = Boolean(m[1]) || globalNextWeek;
    const dayToken = (m[2] ?? "").toLowerCase().replace(/[^a-z]/g, "");
    const weekday = WEEKDAYS[dayToken];
    const hour12 = Number(m[3]);
    const minute = m[4] ? Number(m[4]) : 0;
    if (!weekday || !Number.isFinite(hour12) || !Number.isFinite(minute)) continue;
    const mer = normalizeMer(m[5]) ?? "pm";
    const hour = to24h(hour12, mer);
    const day = nextWeekday(now, weekday, hasNext);
    const start = day.set({ hour, minute, second: 0, millisecond: 0 });
    if (!start.isValid) continue;
    addUnique(slots, { start, end: start.plus({ minutes: defaultDurationMinutes }) });
    if (slots.length >= maxSlots) return slots.slice(0, maxSlots);
  }

  return slots.slice(0, maxSlots);
}
