import { DateTime } from "luxon";

export type ParsedTimeWindow = {
  start: DateTime;
  end: DateTime;
};

const SITTER_KEYWORDS = ["sitter", "babysit", "babysitter", "babysitting"];

function isSitterMessage(text: string): boolean {
  const t = text.toLowerCase();
  return SITTER_KEYWORDS.some((k) => t.includes(k));
}

function findDay(text: string, now: DateTime): DateTime | null {
  const t = text.toLowerCase();
  if (t.includes("tomorrow")) return now.plus({ days: 1 }).startOf("day");
  if (t.includes("today") || t.includes("tonight")) return now.startOf("day");

  const dayMatch =
    /\b(next\s+)?(mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(rs(day)?)?|fri(day)?|sat(urday)?|sun(day)?)\b/i.exec(
      text
    );
  if (!dayMatch) return null;

  const hasNext = Boolean(dayMatch[1]);
  const dayToken = dayMatch[2].toLowerCase();

  const weekdayMap: Record<string, number> = {
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

  const normalized = dayToken.replace(/[^a-z]/g, "");
  const targetWeekday = weekdayMap[normalized];
  if (!targetWeekday) return null;

  let daysAhead = (targetWeekday + 7 - now.weekday) % 7;
  if (daysAhead === 0) daysAhead = 7;
  if (hasNext && daysAhead < 7) daysAhead += 7;

  return now.plus({ days: daysAhead }).startOf("day");
}

function findTimeRange(text: string): {
  sh: number;
  sm: number;
  sMer?: "am" | "pm";
  eh: number;
  em: number;
  eMer?: "am" | "pm";
} | null {
  const m =
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(
      text
    );
  if (!m) return null;

  const sh = Number(m[1]);
  const sm = m[2] ? Number(m[2]) : 0;
  const sMer = m[3]?.toLowerCase() as "am" | "pm" | undefined;
  const eh = Number(m[4]);
  const em = m[5] ? Number(m[5]) : 0;
  const eMer = m[6]?.toLowerCase() as "am" | "pm" | undefined;

  if (!Number.isFinite(sh) || !Number.isFinite(eh)) return null;
  return { sh, sm, sMer, eh, em, eMer };
}

function to24h(hour: number, mer: "am" | "pm"): number {
  if (mer === "am") return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

export function parseSitterRequest(text: string, now: DateTime): ParsedTimeWindow | null {
  if (!isSitterMessage(text)) return null;

  const day = findDay(text, now);
  const range = findTimeRange(text);
  if (!day || !range) return null;

  let sMer = range.sMer;
  let eMer = range.eMer;

  if (sMer && !eMer) eMer = sMer;
  if (eMer && !sMer) sMer = eMer;

  // MVP heuristic: if no am/pm provided, assume PM for sitter requests.
  if (!sMer && !eMer) {
    sMer = "pm";
    eMer = "pm";
  }

  const start = day.set({
    hour: to24h(range.sh, sMer ?? "pm"),
    minute: range.sm,
    second: 0,
    millisecond: 0
  });

  let end = day.set({
    hour: to24h(range.eh, eMer ?? "pm"),
    minute: range.em,
    second: 0,
    millisecond: 0
  });

  if (end <= start) end = end.plus({ days: 1 });

  return { start, end };
}

