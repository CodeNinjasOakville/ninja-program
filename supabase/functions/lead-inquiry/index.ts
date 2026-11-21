// Supabase Edge Function: turns a CRM inquiry email into a new lead marked "new inquiry".
// LineLeader's "Daily Tour Email" (every tour that day) is told apart and handled differently: each
// child on each tour updates the family's existing lead with the GBS date, time and staff member
// (or adds a lead when there isn't one), through add_tour_lead in supabase/schema.sql.
//
// Outlook forwards the CRM emails to an inbound-email address (Postmark), which sends each one here
// as JSON. Set up step by step in INQUIRY_EMAILS.md. The address of this function includes a secret
// (?key=...), stored in Supabase as the INQUIRY_SECRET secret: anything without it is turned away.
//
// Accepts Postmark's inbound JSON (Subject, TextBody, HtmlBody, From, MessageID), or the same in
// lower case (subject, text, html, from, message_id) so another forwarding service can be used.

import { parseInquiryEmail, isDailyTourEmail, parseDailyTourEmail } from "./parse.js";

function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function torontoToday() {
  // en-CA writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
}

Deno.serve(async (req: Request) => {
  const key = new URL(req.url).searchParams.get("key") || "";
  if (!sameSecret(key, Deno.env.get("INQUIRY_SECRET") || "")) return new Response("Not allowed.", { status: 401 });
  if (req.method !== "POST") return new Response("Send the email as a POST.", { status: 405 });

  let mail: Record<string, unknown>;
  try {
    mail = await req.json();
  } catch {
    return new Response("Expected JSON.", { status: 400 });
  }
  const pick = (...names: string[]) => names.map((n) => mail[n]).find((v) => typeof v === "string" && v) as string || "";
  const email = {
    subject: pick("Subject", "subject"),
    text: pick("TextBody", "text", "body"),
    html: pick("HtmlBody", "html"),
    from: pick("From", "from"),
    messageId: pick("MessageID", "message_id", "messageId"),
  };

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rpc = (fn: string, p: unknown) => fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p }),
  });

  if (isDailyTourEmail(email)) {
    const tours = parseDailyTourEmail(email, torontoToday());
    const saved = [];
    // One at a time, so two children of the same family don't both fill the same lead.
    for (const lead of tours) {
      const res = await rpc("add_tour_lead", lead);
      // A failure makes Postmark try again later; tours already saved are not added twice.
      if (!res.ok) return new Response(`Could not save the tour for ${lead.parent_name}: ${await res.text()}`, { status: 500 });
      saved.push({ entry_number: await res.json(), ninja_name: lead.ninja_name, parent_name: lead.parent_name, gbs_time: lead.gbs_time });
    }
    return Response.json({ ok: true, kind: "daily tours", saved });
  }

  const lead = parseInquiryEmail(email, torontoToday());
  const res = await rpc("add_lead_inquiry", lead);
  // A failure here makes Postmark try again later, so nothing is lost while something is fixed.
  if (!res.ok) return new Response(`Could not save the lead: ${await res.text()}`, { status: 500 });
  return Response.json({ ok: true, entry_number: await res.json(), ninja_name: lead.ninja_name });
});
