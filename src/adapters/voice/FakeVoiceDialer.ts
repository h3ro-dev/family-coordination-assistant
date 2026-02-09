import { StartVoiceCallRequest, StartVoiceCallResult, VoiceDialerAdapter } from "./VoiceDialerAdapter";

export class FakeVoiceDialer implements VoiceDialerAdapter {
  public calls: StartVoiceCallRequest[] = [];
  private seq = 0;

  async startCall(req: StartVoiceCallRequest): Promise<StartVoiceCallResult> {
    this.calls.push(req);
    this.seq += 1;
    return { provider: "fake", providerCallId: `FAKE_CALL_${this.seq}` };
  }
}

