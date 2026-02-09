import { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../../config";
import { AppServices } from "../buildServer";
import { withTransaction } from "../../db/pool";
import { requireAdmin } from "../auth/adminAuth";
import { normalizePhoneE164 } from "../../domain/normalize/normalizePhoneE164";

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
  });
}
