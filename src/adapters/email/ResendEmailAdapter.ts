import { Resend } from "resend";
import { EmailAdapter, SendEmailRequest, SendEmailResult } from "./EmailAdapter";

type ResendEmailAdapterOpts = {
  apiKey: string;
};

export class ResendEmailAdapter implements EmailAdapter {
  private resend: Resend;

  constructor(opts: ResendEmailAdapterOpts) {
    this.resend = new Resend(opts.apiKey);
  }

  async sendEmail(req: SendEmailRequest): Promise<SendEmailResult> {
    const res = await this.resend.emails.send({
      from: req.from,
      to: req.to,
      subject: req.subject,
      text: req.text
    });

    if (res.error) {
      throw new Error(`Resend send failed: ${res.error.message}`);
    }

    return {
      provider: "resend",
      providerMessageId: res.data?.id ?? "unknown"
    };
  }
}

