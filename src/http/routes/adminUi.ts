import { FastifyInstance } from "fastify";
import { requireAdmin } from "../auth/adminAuth";
import { withTransaction } from "../../db/pool";
import { normalizePhoneE164 } from "../../domain/normalize/normalizePhoneE164";
import { env } from "../../config";
import { AppServices } from "../buildServer";
import {
  JOB_COMPILE_SITTER_OPTIONS,
  JOB_RETRY_SITTER_OUTREACH
} from "../../jobs/boss";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Arial, sans-serif; margin: 24px; line-height: 1.4; }
    a { color: #0b5fff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .muted { color: #555; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 16px; margin: 12px 0; }
    .row { display: flex; gap: 16px; flex-wrap: wrap; }
    .col { flex: 1 1 360px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #eee; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #fafafa; position: sticky; top: 0; }
    input, select { padding: 8px; width: 100%; box-sizing: border-box; }
    button { padding: 10px 12px; border: 1px solid #ccc; background: #fff; border-radius: 8px; cursor: pointer; }
    button.primary { background: #0b5fff; color: #fff; border-color: #0b5fff; }
    .danger { color: #b00020; }
    .pill { display: inline-block; padding: 2px 8px; border: 1px solid #ddd; border-radius: 999px; font-size: 12px; }
  </style>
</head>
<body>
  <h1>${esc(title)}</h1>
  ${body}
</body>
</html>`;
}

function formRow(label: string, inputHtml: string, hint?: string): string {
  return `<div style="margin: 10px 0;">
    <div style="font-weight: 600; margin-bottom: 6px;">${esc(label)}</div>
    ${inputHtml}
    ${hint ? `<div class="muted" style="font-size: 12px; margin-top: 4px;">${esc(hint)}</div>` : ""}
  </div>`;
}

export function registerAdminUiRoutes(app: FastifyInstance, services: AppServices) {
  app.register(async (adminUi) => {
    requireAdmin(adminUi);

    adminUi.get("/admin-ui", async (_req, reply) => {
      const families = await withTransaction(async (client) => {
        const res = await client.query<{
          id: string;
          assistant_phone_e164: string;
          display_name: string;
          timezone: string;
          created_at: Date;
        }>(
          `
          SELECT id, assistant_phone_e164, display_name, timezone, created_at
          FROM families
          ORDER BY created_at DESC
          LIMIT 50
        `
        );
        return res.rows;
      });

      const rows = families
        .map(
          (f) => `<tr>
            <td><a href="/admin-ui/families/${esc(f.id)}">${esc(f.display_name)}</a></td>
            <td>${esc(f.assistant_phone_e164)}</td>
            <td>${esc(f.timezone)}</td>
            <td class="muted">${esc(f.created_at.toISOString())}</td>
          </tr>`
        )
        .join("");

      const body = `
        <div class="card">
          <a href="/admin-ui/families/new">Create a Family</a>
        </div>
        <div class="card">
          <table>
            <thead><tr><th>Family</th><th>Assistant Phone</th><th>Timezone</th><th>Created</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="4" class="muted">No families yet.</td></tr>`}</tbody>
          </table>
        </div>
      `;

      reply.type("text/html").send(page("FCA Admin", body));
    });

    adminUi.get("/admin-ui/families/new", async (_req, reply) => {
      const body = `
        <div class="card">
          <form method="POST" action="/admin-ui/families/new">
            ${formRow(
              "Assistant Phone (E.164 or US format)",
              `<input name="assistantPhoneE164" placeholder="+18015550000" required />`
            )}
            ${formRow("Display Name", `<input name="displayName" placeholder="Brady Family" required />`)}
            ${formRow(
              "Timezone",
              `<input name="timezone" value="${esc(env.DEFAULT_TIMEZONE)}" required />`,
              "Used for formatting times in messages."
            )}
            <button class="primary" type="submit">Create</button>
          </form>
        </div>
        <div><a href="/admin-ui">Back</a></div>
      `;
      reply.type("text/html").send(page("Create Family", body));
    });

    adminUi.post("/admin-ui/families/new", async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const assistantPhone = String(body.assistantPhoneE164 ?? "").trim();
      const displayName = String(body.displayName ?? "").trim();
      const timezone = String(body.timezone ?? env.DEFAULT_TIMEZONE).trim();

      if (!assistantPhone || !displayName || !timezone) {
        reply.code(400);
        return reply.type("text/html").send(page("Error", `<p class="danger">Missing fields.</p>`));
      }

      const assistantPhoneE164 = normalizePhoneE164(assistantPhone, "US");

      const family = await withTransaction(async (client) => {
        const res = await client.query<{ id: string }>(
          `
          INSERT INTO families (assistant_phone_e164, display_name, timezone)
          VALUES ($1,$2,$3)
          RETURNING id
        `,
          [assistantPhoneE164, displayName, timezone]
        );
        return res.rows[0];
      });

      reply.code(302).header("Location", `/admin-ui/families/${family.id}`).send();
    });

    adminUi.get("/admin-ui/families/:familyId", async (req, reply) => {
      const familyId = (req.params as { familyId: string }).familyId;

      const data = await withTransaction(async (client) => {
        const famRes = await client.query<{
          id: string;
          assistant_phone_e164: string;
          display_name: string;
          timezone: string;
          created_at: Date;
        }>(
          `
          SELECT id, assistant_phone_e164, display_name, timezone, created_at
          FROM families
          WHERE id = $1
        `,
          [familyId]
        );
        const family = famRes.rows[0];
        if (!family) return null;

        const phones = await client.query<{
          id: string;
          phone_e164: string;
          label: string | null;
          role: string;
        }>(
          `
          SELECT id, phone_e164, label, role
          FROM family_authorized_phones
          WHERE family_id = $1
          ORDER BY created_at ASC
        `,
          [familyId]
        );

        const contacts = await client.query<{
          id: string;
          name: string;
          category: string;
          phone_e164: string | null;
          email: string | null;
          channel_pref: string;
          sms_opted_out: boolean;
        }>(
          `
          SELECT id, name, category, phone_e164, email, channel_pref, sms_opted_out
          FROM contacts
          WHERE family_id = $1
          ORDER BY created_at DESC
          LIMIT 200
        `,
          [familyId]
        );

        const tasks = await client.query<{
          id: string;
          intent_type: string;
          status: string;
          awaiting_parent: boolean;
          created_at: Date;
        }>(
          `
          SELECT id, intent_type, status, awaiting_parent, created_at
          FROM tasks
          WHERE family_id = $1
          ORDER BY created_at DESC
          LIMIT 50
        `,
          [familyId]
        );

        return { family, phones: phones.rows, contacts: contacts.rows, tasks: tasks.rows };
      });

      if (!data) {
        reply.code(404);
        return reply.type("text/html").send(page("Not found", `<p>Family not found.</p>`));
      }

      const phoneRows = data.phones
        .map(
          (p) => `<tr><td>${esc(p.phone_e164)}</td><td>${esc(p.label ?? "")}</td><td>${esc(p.role)}</td></tr>`
        )
        .join("");

      const contactRows = data.contacts
        .map(
          (c) => `<tr>
            <td>${esc(c.name)}</td>
            <td>${esc(c.category)}</td>
            <td>${esc(c.channel_pref)} ${c.sms_opted_out ? `<span class="pill danger">SMS opted out</span>` : ""}</td>
            <td class="muted">${esc(c.phone_e164 ?? "")}</td>
            <td class="muted">${esc(c.email ?? "")}</td>
          </tr>`
        )
        .join("");

      const taskRows = data.tasks
        .map(
          (t) => `<tr>
            <td><a href="/admin-ui/tasks/${esc(t.id)}">${esc(t.id.slice(0, 8))}</a></td>
            <td>${esc(t.intent_type)}</td>
            <td>${esc(t.status)} ${t.awaiting_parent ? `<span class="pill">awaiting parent</span>` : ""}</td>
            <td class="muted">${esc(t.created_at.toISOString())}</td>
          </tr>`
        )
        .join("");

      const body = `
        <div class="card">
          <div><strong>${esc(data.family.display_name)}</strong></div>
          <div class="muted">Family ID: ${esc(data.family.id)}</div>
          <div class="muted">Assistant phone: ${esc(data.family.assistant_phone_e164)}</div>
          <div class="muted">Timezone: ${esc(data.family.timezone)}</div>
        </div>

        <div class="row">
          <div class="col card">
            <h2>Authorized Parent Phones</h2>
            <table>
              <thead><tr><th>Phone</th><th>Label</th><th>Role</th></tr></thead>
              <tbody>${phoneRows || `<tr><td colspan="3" class="muted">None yet.</td></tr>`}</tbody>
            </table>
            <hr />
            <form method="POST" action="/admin-ui/families/${esc(data.family.id)}/authorized-phones">
              ${formRow("Phone", `<input name="phone" placeholder="+18015550111" required />`)}
              ${formRow("Label", `<input name="label" placeholder="Primary" />`)}
              ${formRow("Role", `<select name="role">
                <option value="primary">primary</option>
                <option value="caregiver" selected>caregiver</option>
              </select>`)}
              <button type="submit">Add Phone</button>
            </form>
          </div>

          <div class="col card">
            <h2>Contacts</h2>
            <table>
              <thead><tr><th>Name</th><th>Category</th><th>Channel</th><th>Phone</th><th>Email</th></tr></thead>
              <tbody>${contactRows || `<tr><td colspan="5" class="muted">None yet.</td></tr>`}</tbody>
            </table>
            <hr />
            <form method="POST" action="/admin-ui/families/${esc(data.family.id)}/contacts">
              ${formRow("Name", `<input name="name" placeholder="Sarah" required />`)}
              ${formRow(
                "Category",
                `<select name="category">
                  <option value="sitter" selected>sitter</option>
                  <option value="clinic">clinic</option>
                  <option value="coach">coach</option>
                  <option value="other">other</option>
                </select>`
              )}
              ${formRow(
                "Channel preference",
                `<select name="channelPref">
                  <option value="sms" selected>sms</option>
                  <option value="email">email</option>
                </select>`
              )}
              ${formRow("Phone (optional)", `<input name="phone" placeholder="+18015550222" />`)}
              ${formRow("Email (optional)", `<input name="email" placeholder="sarah@example.com" />`)}
              <button type="submit">Add Contact</button>
            </form>
          </div>
        </div>

        <div class="card">
          <h2>Recent Tasks</h2>
          <table>
            <thead><tr><th>Task</th><th>Intent</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>${taskRows || `<tr><td colspan="4" class="muted">None yet.</td></tr>`}</tbody>
          </table>
        </div>

        <div><a href="/admin-ui">Back</a></div>
      `;

      reply.type("text/html").send(page(`Family: ${data.family.display_name}`, body));
    });

    adminUi.post("/admin-ui/families/:familyId/authorized-phones", async (req, reply) => {
      const familyId = (req.params as { familyId: string }).familyId;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const phone = String(body.phone ?? "").trim();
      const label = String(body.label ?? "").trim() || null;
      const role = String(body.role ?? "caregiver").trim() || "caregiver";

      const phoneE164 = normalizePhoneE164(phone, "US");

      await withTransaction(async (client) => {
        await client.query(
          `
          INSERT INTO family_authorized_phones (family_id, phone_e164, label, role)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT (family_id, phone_e164) DO NOTHING
        `,
          [familyId, phoneE164, label, role]
        );
      });

      reply.code(302).header("Location", `/admin-ui/families/${familyId}`).send();
    });

    adminUi.post("/admin-ui/families/:familyId/contacts", async (req, reply) => {
      const familyId = (req.params as { familyId: string }).familyId;
      const body = (req.body ?? {}) as Record<string, unknown>;

      const name = String(body.name ?? "").trim();
      const category = String(body.category ?? "other").trim();
      const channelPref = String(body.channelPref ?? "sms").trim();
      const phoneRaw = String(body.phone ?? "").trim();
      const email = String(body.email ?? "").trim() || null;

      const phoneE164 = phoneRaw ? normalizePhoneE164(phoneRaw, "US") : null;

      await withTransaction(async (client) => {
        await client.query(
          `
          INSERT INTO contacts (family_id, name, category, phone_e164, email, channel_pref)
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (family_id, phone_e164) DO UPDATE
            SET name = EXCLUDED.name,
                category = EXCLUDED.category,
                email = COALESCE(EXCLUDED.email, contacts.email),
                channel_pref = EXCLUDED.channel_pref,
                updated_at = now()
        `,
          [familyId, name, category, phoneE164, email, channelPref]
        );
      });

      reply.code(302).header("Location", `/admin-ui/families/${familyId}`).send();
    });

    adminUi.get("/admin-ui/tasks/:taskId", async (req, reply) => {
      const taskId = (req.params as { taskId: string }).taskId;

      const data = await withTransaction(async (client) => {
        const res = await client.query<{
          id: string;
          family_id: string;
          intent_type: string;
          status: string;
          awaiting_parent: boolean;
          awaiting_parent_reason: string | null;
          requested_start: Date | null;
          requested_end: Date | null;
          metadata: unknown;
          created_at: Date;
        }>(
          `
          SELECT
            id, family_id, intent_type, status, awaiting_parent, awaiting_parent_reason,
            requested_start, requested_end, metadata, created_at
          FROM tasks
          WHERE id = $1
        `,
          [taskId]
        );
        const task = res.rows[0];
        if (!task) return null;

        const options = await client.query<{
          id: string;
          name: string;
          slot_start: Date;
          slot_end: Date;
          status: string;
          rank: number;
        }>(
          `
          SELECT o.id, c.name, o.slot_start, o.slot_end, o.status, o.rank
          FROM task_options o
          JOIN contacts c ON c.id = o.contact_id
          WHERE o.task_id = $1
          ORDER BY o.rank ASC
        `,
          [taskId]
        );

        const outreach = await client.query<{
          id: string;
          name: string;
          channel: string;
          status: string;
          sent_at: Date | null;
        }>(
          `
          SELECT o.id, c.name, o.channel, o.status, o.sent_at
          FROM task_outreach o
          JOIN contacts c ON c.id = o.contact_id
          WHERE o.task_id = $1
          ORDER BY o.created_at ASC
        `,
          [taskId]
        );

        const responses = await client.query<{
          name: string;
          response: string;
          received_at: Date;
        }>(
          `
          SELECT c.name, r.response, r.received_at
          FROM task_contact_responses r
          JOIN contacts c ON c.id = r.contact_id
          WHERE r.task_id = $1
          ORDER BY r.received_at ASC
        `,
          [taskId]
        );

        const messages = await client.query<{
          direction: string;
          channel: string;
          from_addr: string;
          to_addr: string;
          body: string;
          occurred_at: Date;
        }>(
          `
          SELECT direction, channel, from_addr, to_addr, body, occurred_at
          FROM message_events
          WHERE task_id = $1
          ORDER BY occurred_at ASC
          LIMIT 200
        `,
          [taskId]
        );

        return { task, options: options.rows, outreach: outreach.rows, responses: responses.rows, messages: messages.rows };
      });

      if (!data) {
        reply.code(404);
        return reply.type("text/html").send(page("Not found", `<p>Task not found.</p>`));
      }

      const optRows = data.options
        .map(
          (o) => `<tr><td>${esc(String(o.rank))}</td><td>${esc(o.name)}</td><td>${esc(o.status)}</td><td class="muted">${esc(
            o.slot_start.toISOString()
          )}</td><td class="muted">${esc(o.slot_end.toISOString())}</td></tr>`
        )
        .join("");

      const outreachRows = data.outreach
        .map(
          (o) => `<tr><td>${esc(o.name)}</td><td>${esc(o.channel)}</td><td>${esc(o.status)}</td><td class="muted">${esc(
            o.sent_at ? o.sent_at.toISOString() : ""
          )}</td></tr>`
        )
        .join("");

      const responseRows = data.responses
        .map(
          (r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.response)}</td><td class="muted">${esc(r.received_at.toISOString())}</td></tr>`
        )
        .join("");

      const messageRows = data.messages
        .map(
          (m) => `<tr><td>${esc(m.direction)}</td><td>${esc(m.channel)}</td><td class="muted">${esc(m.from_addr)}</td><td class="muted">${esc(m.to_addr)}</td><td>${esc(m.body)}</td><td class="muted">${esc(
            m.occurred_at.toISOString()
          )}</td></tr>`
        )
        .join("");

      const body = `
        <div class="card">
          <div><strong>Task</strong> ${esc(data.task.id)}</div>
          <div class="muted">Family: <a href="/admin-ui/families/${esc(data.task.family_id)}">${esc(
            data.task.family_id
          )}</a></div>
          <div>Status: ${esc(data.task.status)} ${data.task.awaiting_parent ? `<span class="pill">awaiting parent</span>` : ""}</div>
          <div class="muted">Await reason: ${esc(data.task.awaiting_parent_reason ?? "")}</div>
        </div>

        <div class="card">
          <form method="POST" action="/admin-ui/tasks/${esc(data.task.id)}/cancel" style="display:inline-block; margin-right: 8px;">
            <button class="danger" type="submit">Cancel Task</button>
          </form>
          <form method="POST" action="/admin-ui/tasks/${esc(data.task.id)}/compile-now" style="display:inline-block; margin-right: 8px;">
            <button type="submit">Compile Options Now</button>
          </form>
          <form method="POST" action="/admin-ui/tasks/${esc(data.task.id)}/retry-now" style="display:inline-block;">
            <button type="submit">Retry Outreach Now</button>
          </form>
        </div>

        <div class="row">
          <div class="col card">
            <h2>Outreach</h2>
            <table>
              <thead><tr><th>Contact</th><th>Channel</th><th>Status</th><th>Sent</th></tr></thead>
              <tbody>${outreachRows || `<tr><td colspan="4" class="muted">None.</td></tr>`}</tbody>
            </table>
          </div>

          <div class="col card">
            <h2>Responses</h2>
            <table>
              <thead><tr><th>Contact</th><th>Response</th><th>Received</th></tr></thead>
              <tbody>${responseRows || `<tr><td colspan="3" class="muted">None.</td></tr>`}</tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h2>Options</h2>
          <table>
            <thead><tr><th>Rank</th><th>Contact</th><th>Status</th><th>Start</th><th>End</th></tr></thead>
            <tbody>${optRows || `<tr><td colspan="5" class="muted">None.</td></tr>`}</tbody>
          </table>
        </div>

        <div class="card">
          <h2>Message Log</h2>
          <table>
            <thead><tr><th>Dir</th><th>Ch</th><th>From</th><th>To</th><th>Body</th><th>At</th></tr></thead>
            <tbody>${messageRows || `<tr><td colspan="6" class="muted">None.</td></tr>`}</tbody>
          </table>
        </div>

        <div><a href="/admin-ui/families/${esc(data.task.family_id)}">Back to family</a></div>
      `;

      reply.type("text/html").send(page(`Task ${data.task.id.slice(0, 8)}`, body));
    });

    adminUi.post("/admin-ui/tasks/:taskId/cancel", async (req, reply) => {
      const taskId = (req.params as { taskId: string }).taskId;

      const familyId = await withTransaction(async (client) => {
        const res = await client.query<{ family_id: string }>(
          `
          UPDATE tasks
          SET status = 'cancelled',
              awaiting_parent = false,
              awaiting_parent_reason = NULL,
              updated_at = now()
          WHERE id = $1
          RETURNING family_id
        `,
          [taskId]
        );
        return res.rows[0]?.family_id ?? null;
      });

      if (!familyId) {
        reply.code(404).send();
        return;
      }

      reply.code(302).header("Location", `/admin-ui/tasks/${taskId}`).send();
    });

    adminUi.post("/admin-ui/tasks/:taskId/compile-now", async (req, reply) => {
      const taskId = (req.params as { taskId: string }).taskId;
      if (!services.boss) {
        reply.code(500);
        return reply.type("text/html").send(page("Error", "<p>Job queue not configured.</p>"));
      }
      await services.boss.send(JOB_COMPILE_SITTER_OPTIONS, { taskId }, { startAfter: new Date() });
      reply.code(302).header("Location", `/admin-ui/tasks/${taskId}`).send();
    });

    adminUi.post("/admin-ui/tasks/:taskId/retry-now", async (req, reply) => {
      const taskId = (req.params as { taskId: string }).taskId;
      if (!services.boss) {
        reply.code(500);
        return reply.type("text/html").send(page("Error", "<p>Job queue not configured.</p>"));
      }
      await services.boss.send(JOB_RETRY_SITTER_OUTREACH, { taskId }, { startAfter: new Date() });
      reply.code(302).header("Location", `/admin-ui/tasks/${taskId}`).send();
    });
  });
}
