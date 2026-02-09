import { parsePhoneNumberFromString } from "libphonenumber-js";

export function normalizePhoneE164(
  input: string,
  defaultCountry: "US" = "US"
): string {
  const phone = parsePhoneNumberFromString(input, defaultCountry);
  if (!phone || !phone.isValid()) {
    throw new Error(`Invalid phone number: ${input}`);
  }
  return phone.number;
}

