import { describe, expect, test } from "vitest";
import { parseContactList } from "../parseContactList";

describe("parseContactList", () => {
  test("parses semicolon-separated name + phone pairs", () => {
    const res = parseContactList("Sarah 801-555-1234; Jenna (801) 555-4567", "US");
    expect(res.length).toBe(2);
    expect(res[0].name.toLowerCase()).toContain("sarah");
    expect(res[0].phoneE164).toBe("+18015551234");
    expect(res[1].name.toLowerCase()).toContain("jenna");
    expect(res[1].phoneE164).toBe("+18015554567");
  });

  test("ignores invalid phone numbers", () => {
    const res = parseContactList("Sarah 123; Jenna 801-555-4567", "US");
    expect(res.length).toBe(1);
    expect(res[0].phoneE164).toBe("+18015554567");
  });

  test("defaults missing name to Unknown when phone is present", () => {
    const res = parseContactList("801-555-1234", "US");
    expect(res.length).toBe(1);
    expect(res[0].name).toBe("Unknown");
    expect(res[0].phoneE164).toBe("+18015551234");
  });
});

