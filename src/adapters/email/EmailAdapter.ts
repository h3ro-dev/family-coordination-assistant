export type SendEmailRequest = {
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
};

export type SendEmailResult = {
  provider: "resend" | "fake";
  providerMessageId: string;
};

export interface EmailAdapter {
  sendEmail(req: SendEmailRequest): Promise<SendEmailResult>;
}
