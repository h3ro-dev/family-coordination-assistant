import { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../../config";
import { AppServices } from "../buildServer";
import { withTransaction } from "../../db/pool";
import { requireAdmin } from "../auth/adminAuth";
import { normalizePhoneE164 } from "../../domain/normalize/normalizePhoneE164";
import { enqueueVoiceJobNow } from "../../workers/voiceJobs";

export function registerAdminRoutes(app: FastifyInstance, _services: AppServices) {
  app.register(async (admin) => {
    requireAdmin(admin);

    admin.post("/admin/families", async (req) => {
      const schema = z.object({
        assistantPhoneE164: z.string().min(1),
        displayName: z.string().min(1),
        timezone: z.string().min(1).default(env.DEFAULT_TIMEZONE)
      });
      const input = schema.parse(req.body ?? {});

      const row = await withTransaction(async (client) => {
        const res = await client.query<{
          id: string;
          assistant_phone_e164: string;
          display_name: string;
          timezone: string;
        }>(
          `
          INSERT INTO families (assistant_phone_e164, display_name, timezone)
          VALUES ($1, $2, $3)
          RETURNING id, assistant_phone_e164, display_name, timezone
        `,
          [
            normalizePhoneE164(input.assistantPhoneE164, "US"),
            input.displayName,
            input.timezone
          ]
        );
        return res.rows[0];
      });

      return { ok: true, family: row };
    });

    admin.post("/admin/families/:familyId/authorized-phones", async (req) => {
      const schema = z.object({
        phoneE164: z.string().min(1),
        label: z.string().optional(),
        role: z.string().min(1).optional()
      });
      const input = schema.parse(req.body ?? {});
      const familyId = (req.params as { familyId: string }).familyId;

      const row = await withTransaction(async (client) => {
        const res = await client.query(
          `
          INSERT INTO family_authorized_phones (family_id, phone_e164, label, role)
          VALUES ($1, $2, $3, COALESCE($4, 'caregiver'))
          RETURNING id, family_id, phone_e164, label, role
        `,
          [
            familyId,
            normalizePhoneE164(input.phoneE164, "US"),
            input.label ?? null,
            input.role ?? null
          ]
        );
        return res.rows[0];
      });

      return { ok: true, authorizedPhone: row };
    });

    admin.post("/admin/families/:familyId/contacts", async (req) => {
      const schema = z.object({
        name: z.string().min(1),
        category: z.string().min(1),
        phoneE164: z.string().min(1).optional(),
        email: z.string().email().optional(),
        channelPref: z.enum(["sms", "email"]).default("sms")
      });
      const input = schema.parse(req.body ?? {});
      const familyId = (req.params as { familyId: string }).familyId;

      const row = await withTransaction(async (client) => {
        const res = await client.query(
          `
          INSERT INTO contacts (family_id, name, category, phone_e164, email, channel_pref)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, family_id, name, category, phone_e164, email, channel_pref
        `,
          [
            familyId,
            input.name,
            input.category,
            input.phoneE164 ? normalizePhoneE164(input.phoneE164, "US") : null,
            input.email ?? null,
            input.channelPref
          ]
        );
        return res.rows[0];
      });

      return { ok: true, contact: row };
    });

    admin.post("/admin/families/:familyId/tasks", async (req, reply) => {
      const schema = z.object({
        intentType: z.enum(["clinic", "therapy"]).default("clinic"),
        initiatorPhoneE164: z.string().min(1),
        clinicContactId: z.string().uuid(),
        requestText: z.string().min(1)
      });
      const input = schema.parse(req.body ?? {});
      const familyId = (req.params as { familyId: string }).familyId;

      const initiatorPhoneE164 = normalizePhoneE164(input.initiatorPhoneE164, "US");

      const row = await withTransaction(async (client) => {
        const authRes = await client.query<{ id: string }>(
          `
            SELECT id
            FROM family_authorized_phones
            WHERE family_id = $1 AND phone_e164 = $2
            LIMIT 1
          `,
          [familyId, initiatorPhoneE164]
        );
        if (authRes.rowCount !== 1) return null;

        const contactRes = await client.query<{ id: string }>(
          `
            SELECT id
            FROM contacts
            WHERE id = $1 AND family_id = $2
            LIMIT 1
          `,
          [input.clinicContactId, familyId]
        );
        if (contactRes.rowCount !== 1) return null;

        const metadata = {
          initiatorPhoneE164,
          requestText: input.requestText,
          clinicContactId: input.clinicContactId
        };

        const taskRes = await client.query<{
          id: string;
          family_id: string;
          intent_type: string;
          status: string;
        }>(
          `
            INSERT INTO tasks (family_id, intent_type, status, awaiting_parent, metadata)
            VALUES ($1,$2,'collecting',false,$3::jsonb)
            RETURNING id, family_id, intent_type, status
          `,
          [familyId, input.intentType, JSON.stringify(metadata)]
        );
        const task = taskRes.rows[0];

        await client.query(
          `
            INSERT INTO task_outreach (task_id, contact_id, channel, sent_at, status)
            VALUES ($1,$2,'voice',NULL,'queued')
            ON CONFLICT (task_id, contact_id, channel) DO NOTHING
          `,
          [task.id, input.clinicContactId]
        );

        const voiceJobRes = await client.query<{ id: string }>(
          `
            INSERT INTO voice_jobs (family_id, task_id, contact_id, kind, status, provider)
            VALUES ($1,$2,$3,'availability','queued','twilio')
            RETURNING id
          `,
          [familyId, task.id, input.clinicContactId]
        );

        return { ...task, voiceJobId: voiceJobRes.rows[0]?.id };
      });

      if (!row) {
        reply.code(400);
        return { ok: false, error: "invalid_family_or_phone_or_contact" };
      }

      // Best-effort: enqueue outbound voice availability call now.
      // The worker is responsible for actually dialing.
      if (row.voiceJobId) {
        await enqueueVoiceJobNow(_services, row.voiceJobId);
      }

      return { ok: true, task: row };
    });
  });
}
