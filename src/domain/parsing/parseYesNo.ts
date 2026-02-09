export type YesNo = "yes" | "no" | "unknown";

export function parseYesNo(text: string): YesNo {
  const t = text.trim().toLowerCase();
  if (!t) return "unknown";

  const yes =
    /\b(y|yes|yep|yeah|sure|ok|okay|available|can do)\b/.test(t) ||
    t === "👍";
  const no = /\b(no|nope|nah|can't|cannot|unavailable)\b/.test(t);

  if (yes && !no) return "yes";
  if (no && !yes) return "no";
  return "unknown";
}

