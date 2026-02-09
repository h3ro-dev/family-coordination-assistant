import { env } from "./config";
import {
  createBoss,
  JOB_COMPILE_SITTER_OPTIONS,
  JOB_RETENTION_CLEANUP,
  JOB_RETRY_SITTER_OUTREACH
} from "./jobs/boss";
import { runRetentionCleanup } from "./workers/retentionCleanup";
import { TwilioSmsAdapter } from "./adapters/sms/TwilioSmsAdapter";
import { ResendEmailAdapter } from "./adapters/email/ResendEmailAdapter";
import { compileSitterOptions, retrySitterOutreach } from "./workers/sitterJobs";
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

  const services = {
    sms:
      env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN
        ? new TwilioSmsAdapter({
            accountSid: requireString(env.TWILIO_ACCOUNT_SID, "TWILIO_ACCOUNT_SID"),
            authToken: requireString(env.TWILIO_AUTH_TOKEN, "TWILIO_AUTH_TOKEN")
          })
        : (() => {
            if (isProd) throw new Error("Missing TWILIO_* env vars in production");
            console.warn("[worker] TWILIO_* not set. Using FakeSmsAdapter.");
            return new FakeSmsAdapter();
          })(),
    email:
      env.RESEND_API_KEY && env.EMAIL_FROM
        ? new ResendEmailAdapter({
            apiKey: requireString(env.RESEND_API_KEY, "RESEND_API_KEY")
          })
        : (() => {
            if (isProd) throw new Error("Missing RESEND_API_KEY/EMAIL_FROM in production");
            console.warn("[worker] RESEND_* not set. Using FakeEmailAdapter.");
            return new FakeEmailAdapter();
          })(),
    boss
  };

  boss.work(JOB_COMPILE_SITTER_OPTIONS, async (jobs) => {
    for (const job of jobs) {
      const taskId = (job.data as { taskId?: string }).taskId;
      if (!taskId) continue;
      await compileSitterOptions(services, taskId);
    }
    return null;
  });

  boss.work(JOB_RETRY_SITTER_OUTREACH, async (jobs) => {
    for (const job of jobs) {
      const taskId = (job.data as { taskId?: string }).taskId;
      if (!taskId) continue;
      await retrySitterOutreach(services, taskId);
    }
    return null;
  });

  boss.work(JOB_RETENTION_CLEANUP, async () => {
    await runRetentionCleanup();
    return null;
  });

  // Daily at 03:15 server time. (Can adjust per region later.)
  await boss.schedule(JOB_RETENTION_CLEANUP, "15 3 * * *");

  console.log("[worker] started");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
