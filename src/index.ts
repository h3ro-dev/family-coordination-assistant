import { env } from "./config";
import { buildServer } from "./http/buildServer";
import { TwilioSmsAdapter } from "./adapters/sms/TwilioSmsAdapter";
import { ResendEmailAdapter } from "./adapters/email/ResendEmailAdapter";
import { createBoss } from "./jobs/boss";

function requireString(val: string | undefined, name: string): string {
  if (!val) throw new Error(`Missing env var: ${name}`);
  return val;
}

async function main() {
  const boss = createBoss();
  await boss.start();

  const sms = new TwilioSmsAdapter({
    accountSid: requireString(env.TWILIO_ACCOUNT_SID, "TWILIO_ACCOUNT_SID"),
    authToken: requireString(env.TWILIO_AUTH_TOKEN, "TWILIO_AUTH_TOKEN")
  });

  const email = new ResendEmailAdapter({
    apiKey: requireString(env.RESEND_API_KEY, "RESEND_API_KEY")
  });

  const app = buildServer({ sms, email, boss });

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
