import { parsePhoneNumberFromString } from "libphonenumber-js";

export type ParsedContact = {
  name: string;
  phoneE164: string;
};

// MVP: parse messages like "Sarah 801-555-1234; Jenna 801-555-4567".
export function parseContactList(text: string, defaultCountry: "US" = "US"): ParsedContact[] {
  const parts = text
    .split(/[\n;]+/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const results: ParsedContact[] = [];

  for (const part of parts) {
    const phone = parsePhoneNumberFromString(part, defaultCountry);
    if (!phone || !phone.isValid()) continue;

    const phoneE164 = phone.number;
    const rawName = part
      .replace(phone.number, "")
      .replace(/[()\-.\s]+/g, " ")
      .replace(/\b\d+\b/g, " ")
      .trim();

    const name = rawName || "Unknown";
    results.push({ name, phoneE164 });
  }

  return results;
}

