import { DateTime } from "luxon";
import { ParsedTimeWindow, parseTimeWindow } from "./parseTimeWindow";

const SITTER_KEYWORDS = ["sitter", "babysit", "babysitter", "babysitting"];

export function isSitterIntent(text: string): boolean {
  const t = text.toLowerCase();
  return SITTER_KEYWORDS.some((k) => t.includes(k));
}

export function parseSitterRequest(text: string, now: DateTime): ParsedTimeWindow | null {
  if (!isSitterIntent(text)) return null;
  return parseTimeWindow(text, now);
}
