export type StartVoiceCallRequest = {
  to: string;
  from: string;
  /**
   * Twilio will request this URL (POST) when the call is answered, expecting TwiML.
   * Include any auth tokens in the URL/querystring.
   */
  answerUrl: string;
  /**
   * Optional Twilio status callback URL (POST).
   */
  statusCallbackUrl?: string;
};

export type StartVoiceCallResult = {
  provider: "twilio" | "fake";
  providerCallId: string;
};

export interface VoiceDialerAdapter {
  startCall(req: StartVoiceCallRequest): Promise<StartVoiceCallResult>;
}

