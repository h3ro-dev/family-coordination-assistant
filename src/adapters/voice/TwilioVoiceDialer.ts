import { StartVoiceCallRequest, StartVoiceCallResult, VoiceDialerAdapter } from "./VoiceDialerAdapter";

type TwilioVoiceDialerOpts = {
  accountSid: string;
  authToken: string;
};

/**
 * Minimal Twilio Voice adapter (outbound calls).
 *
 * This uses the Twilio REST API directly (no SDK) to keep dependencies small,
 * mirroring the existing TwilioSmsAdapter approach.
 */
export class TwilioVoiceDialer implements VoiceDialerAdapter {
  private accountSid: string;
  private authToken: string;

  constructor(opts: TwilioVoiceDialerOpts) {
    this.accountSid = opts.accountSid;
    this.authToken = opts.authToken;
  }

  async startCall(req: StartVoiceCallRequest): Promise<StartVoiceCallResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
      this.accountSid
    )}/Calls.json`;

    const form = new URLSearchParams();
    form.set("From", req.from);
    form.set("To", req.to);
    form.set("Url", req.answerUrl);
    form.set("Method", "POST");

    if (req.statusCallbackUrl) {
      form.set("StatusCallback", req.statusCallbackUrl);
      form.set("StatusCallbackMethod", "POST");
      // Request common lifecycle events so we can mark failures in DB.
      form.set("StatusCallbackEvent", "initiated ringing answered completed");
    }

    const basicAuth = Buffer.from(`${this.accountSid}:${this.authToken}`, "utf8").toString("base64");

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form.toString()
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Twilio call create failed (${res.status}): ${text.slice(0, 500)}`);
    }

    const json = (await res.json()) as { sid?: string };
    return { provider: "twilio", providerCallId: json.sid ?? "unknown" };
  }
}

