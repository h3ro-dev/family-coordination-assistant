import { EmailAdapter, SendEmailRequest, SendEmailResult } from "./EmailAdapter";

export type FakeSentEmail = SendEmailRequest & { providerMessageId: string };

export class FakeEmailAdapter implements EmailAdapter {
  public sent: FakeSentEmail[] = [];
  private _id = 0;

  async sendEmail(req: SendEmailRequest): Promise<SendEmailResult> {
    this._id += 1;
    const providerMessageId = `fake-email-${this._id}`;
    this.sent.push({ ...req, providerMessageId });
    return { provider: "fake", providerMessageId };
  }
}

