import { env } from "./config";
import { buildServer } from "./http/buildServer";
import { TwilioSmsAdapter } from "./adapters/sms/TwilioSmsAdapter";
import { ResendEmailAdapter } from "./adapters/email/ResendEmailAdapter";
import { createBoss } from "./jobs/boss";
import { FakeSmsAdapter } from "./adapters/sms/FakeSmsAdapter";
import { FakeEmailAdapter } from "./adapters/email/FakeEmailAdapter";

function requireString(val: string | undefined, name: string): string {
  if (!val) throw new Error(`Missing env var: ${name}`);
  return val;
}

async function main() {
  const boss = createBoss();
  await boss.start();

  const isProd = env.NODE_ENV === "production";

  const sms =
    env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN
      ? new TwilioSmsAdapter({
          accountSid: requireString(env.TWILIO_ACCOUNT_SID, "TWILIO_ACCOUNT_SID"),
          authToken: requireString(env.TWILIO_AUTH_TOKEN, "TWILIO_AUTH_TOKEN")
        })
      : (() => {
          if (isProd) throw new Error("Missing TWILIO_* env vars in production");
          console.warn("[api] TWILIO_* not set. Using FakeSmsAdapter (no real SMS will be sent).");
          return new FakeSmsAdapter();
        })();

  const email =
    env.RESEND_API_KEY && env.EMAIL_FROM
      ? new ResendEmailAdapter({
          apiKey: requireString(env.RESEND_API_KEY, "RESEND_API_KEY")
        })
      : (() => {
          if (isProd) throw new Error("Missing RESEND_API_KEY/EMAIL_FROM in production");
          console.warn("[api] RESEND_* not set. Using FakeEmailAdapter (no real email will be sent).");
          return new FakeEmailAdapter();
        })();

  const app = buildServer({ sms, email, boss });

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
