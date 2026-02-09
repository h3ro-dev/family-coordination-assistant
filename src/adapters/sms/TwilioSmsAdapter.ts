import { SmsAdapter, SendSmsRequest, SendSmsResult } from "./SmsAdapter";

type TwilioSmsAdapterOpts = {
  accountSid: string;
  authToken: string;
};

export class TwilioSmsAdapter implements SmsAdapter {
  private accountSid: string;
  private authToken: string;

  constructor(opts: TwilioSmsAdapterOpts) {
    this.accountSid = opts.accountSid;
    this.authToken = opts.authToken;
  }

  async sendSms(req: SendSmsRequest): Promise<SendSmsResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
      this.accountSid
    )}/Messages.json`;

    const form = new URLSearchParams();
    form.set("From", req.from);
    form.set("To", req.to);
    form.set("Body", req.body);

    const basicAuth = Buffer.from(
      `${this.accountSid}:${this.authToken}`,
      "utf8"
    ).toString("base64");

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
      throw new Error(
        `Twilio send failed (${res.status}): ${text.slice(0, 500)}`
      );
    }

    const json = (await res.json()) as { sid?: string };
    const providerMessageId = json.sid ?? "unknown";
    return { provider: "twilio", providerMessageId };
  }
}

