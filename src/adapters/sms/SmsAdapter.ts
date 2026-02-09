export type SendSmsRequest = {
  from: string;
  to: string;
  body: string;
};

export type SendSmsResult = {
  provider: "twilio" | "fake";
  providerMessageId: string;
};

export interface SmsAdapter {
  sendSms(req: SendSmsRequest): Promise<SendSmsResult>;
}

