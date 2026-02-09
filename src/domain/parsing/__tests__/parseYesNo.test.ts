import { describe, expect, test } from "vitest";
import { parseYesNo } from "../parseYesNo";

describe("parseYesNo", () => {
  test("detects yes", () => {
    expect(parseYesNo("Yes")).toBe("yes");
    expect(parseYesNo("yep, can do")).toBe("yes");
  });

  test("detects no", () => {
    expect(parseYesNo("No")).toBe("no");
    expect(parseYesNo("can't")).toBe("no");
  });

  test("detects unknown", () => {
    expect(parseYesNo("maybe")).toBe("unknown");
    expect(parseYesNo("")).toBe("unknown");
  });
});

