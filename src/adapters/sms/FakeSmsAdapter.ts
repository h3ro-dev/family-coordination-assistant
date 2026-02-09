import { SmsAdapter, SendSmsRequest, SendSmsResult } from "./SmsAdapter";

export type FakeSentSms = SendSmsRequest & { providerMessageId: string };

export class FakeSmsAdapter implements SmsAdapter {
  public sent: FakeSentSms[] = [];
  private _id = 0;

  async sendSms(req: SendSmsRequest): Promise<SendSmsResult> {
    this._id += 1;
    const providerMessageId = `fake-sms-${this._id}`;
    this.sent.push({ ...req, providerMessageId });
    return { provider: "fake", providerMessageId };
  }
}

