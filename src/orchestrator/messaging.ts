import { AppServices } from "../http/buildServer";
import { withTransaction } from "../db/pool";

export async function sendAndLogSms(args: {
  services: AppServices;
  familyId: string;
  taskId?: string;
  from: string;
  to: string;
  body: string;
  occurredAt: Date;
}): Promise<void> {
  const res = await args.services.sms.sendSms({
    from: args.from,
    to: args.to,
    body: args.body
  });

  await withTransaction(async (client) => {
    await client.query(
      `
      INSERT INTO message_events (
        family_id, task_id, direction, channel, from_addr, to_addr, body,
        provider, provider_message_id, occurred_at
      ) VALUES ($1,$2,'outbound','sms',$3,$4,$5,$6,$7,$8)
    `,
      [
        args.familyId,
        args.taskId ?? null,
        args.from,
        args.to,
        args.body,
        res.provider,
        res.providerMessageId,
        args.occurredAt
      ]
    );
  });
}

