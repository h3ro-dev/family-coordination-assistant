import { describe, expect, test } from "vitest";
import { DateTime } from "luxon";
import { parseTimeWindow } from "../parseTimeWindow";

describe("parseTimeWindow", () => {
  test("parses 'Friday 6-10' relative to a Monday", () => {
    const now = DateTime.fromISO("2026-02-09T10:00:00", { zone: "America/Denver" });
    const parsed = parseTimeWindow("Friday 6-10", now);
    expect(parsed).not.toBeNull();
    expect(parsed!.start.toISO()).toContain("2026-02-13T18:00:00");
    expect(parsed!.end.toISO()).toContain("2026-02-13T22:00:00");
  });
});

