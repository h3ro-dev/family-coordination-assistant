import { describe, expect, test } from "vitest";
import { DateTime } from "luxon";
import { parseOfferedSlotsFromTranscript } from "../parseOfferedSlotsFromTranscript";

describe("parseOfferedSlotsFromTranscript", () => {
  test("extracts weekday + time (defaults PM)", () => {
    const now = DateTime.fromISO("2026-02-09T12:00:00.000-07:00", { zone: "America/Denver" }); // Monday
    const slots = parseOfferedSlotsFromTranscript("Tuesday 3:30 or Thu 4:15", {
      now,
      defaultDurationMinutes: 45
    });
    expect(slots.length).toBe(2);
    expect(slots[0]!.start.toISO()).toContain("2026-02-10T15:30");
    expect(slots[0]!.end.toISO()).toContain("2026-02-10T16:15");
    expect(slots[1]!.start.toISO()).toContain("2026-02-12T16:15");
  });

  test("extracts month name + day + time", () => {
    const now = DateTime.fromISO("2026-02-09T12:00:00.000-07:00", { zone: "America/Denver" });
    const slots = parseOfferedSlotsFromTranscript("Feb 12 at 3:30pm and February 14 4:15", {
      now,
      defaultDurationMinutes: 30
    });
    expect(slots.length).toBe(2);
    expect(slots[0]!.start.toISO()).toContain("2026-02-12T15:30");
    expect(slots[1]!.start.toISO()).toContain("2026-02-14T16:15");
  });

  test("extracts numeric date + time", () => {
    const now = DateTime.fromISO("2026-02-09T12:00:00.000-07:00", { zone: "America/Denver" });
    const slots = parseOfferedSlotsFromTranscript("2/12 3:30 and 2/14 4:15pm", {
      now,
      defaultDurationMinutes: 60
    });
    expect(slots.length).toBe(2);
    expect(slots[0]!.start.toISO()).toContain("2026-02-12T15:30");
    expect(slots[0]!.end.toISO()).toContain("2026-02-12T16:30");
    expect(slots[1]!.start.toISO()).toContain("2026-02-14T16:15");
  });

  test("respects 'next week' cue for weekday matches", () => {
    const now = DateTime.fromISO("2026-02-09T12:00:00.000-07:00", { zone: "America/Denver" }); // Monday
    const slots = parseOfferedSlotsFromTranscript("Next week Tuesday 3:30", {
      now,
      defaultDurationMinutes: 45
    });
    expect(slots.length).toBe(1);
    // Next Tuesday (one week ahead) should be 2026-02-17.
    expect(slots[0]!.start.toISO()).toContain("2026-02-17T15:30");
  });
});

