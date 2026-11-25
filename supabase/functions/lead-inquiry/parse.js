// Reads a CRM inquiry email and picks out the lead's details.
//
// CRM notification emails list the form answers as "Label: value" lines, as a table
// (label cell, value cell), or with the value on the line under its label. All three are read.
// Labels are matched loosely (see FIELD_LABELS), so "Child's Name", "Student name" and
// "Participant" all mean the Ninja. Anything that can't be placed is left blank, and the whole
// email is kept with the lead (inquiry_email) so staff can always read the original.
//
// Plain JavaScript with no imports, so the same file runs on Supabase (Deno) and in the tests (Node).

// label (lower case, punctuation removed) -> lead field. Checked in this order; the first match wins.
const FIELD_LABELS = [
  ["ninja_first", /^(child|childs|student|students|participant|participants|kid|kids|camper|ninja|ninjas) first name$/],
  ["ninja_last", /^(child|childs|student|students|participant|participants|kid|kids|camper|ninja|ninjas) last name$/],
  ["ninja_name", /^((child|childs|student|students|participant|participants|kid|kids|camper|ninja|ninjas)( full)? name|name of (child|student|participant)|child|student|participant|camper)$/],
  ["age_dob", /^((child|childs|student|students|participant|participants) )?(date of birth|birth ?date|birthday|dob)$/],
  ["age", /^((child|childs|student|students|participant|participants|kid|kids) )?age( of (child|student|participant))?$/],
  ["parent_first", /^((parent|guardian|parentguardian|contact|your) )?first name$/],
  ["parent_last", /^((parent|guardian|parentguardian|contact|your) )?last name$/],
  ["parent_name", /^((parent|guardian|parentguardian|parent or guardian|contact|customer|your|full)( full)? name|parent|guardian|parentguardian|name|contact)$/],
  ["phone_number", /^((parent|guardian|contact|best|primary|mobile|cell|home) )?(phone|phone number|mobile|mobile number|cell|cell phone|cell number|telephone|tel|contact number)$/],
  ["email", /^((parent|guardian|contact|your) )?(e ?mail|e ?mail address)$/],
  ["gbs_when", /^(appointment|booking|session|gbs|game building session|event|scheduled for|start|start time|date and time|date time)$/],
  ["gbs_date", /^((preferred|requested|appointment|booking|session|gbs|event|visit|tour|trial|class) )+date$|^date of (gbs|session|visit|event|appointment)$/],
  ["gbs_time", /^((preferred|requested|appointment|booking|session|gbs|event|visit|tour|trial|class) )+time$|^time of (gbs|session|visit|event|appointment)$/],
  ["gbs_type", /^(program|programs|program of interest|programs of interest|interested in|interest|event type|gbs type|session type|inquiry type|class type|service|location type)$/],
  ["coding_experience", /^((prior|previous|any|coding|programming)( coding| programming)? )?experience|has (your|the) child (coded|done coding|programmed)( before)?$/],
  ["heard_from", /^(how did you hear about us|how did you hear about code ninjas|heard about us|referral source|source|lead source)$/],
  ["comments", /^(comments?|message|messages|notes?|additional (info|information|comments|notes)|questions?|anything else.*|details|inquiry|your message)$/],
];

// Lines from the "forwarded message" header block, never form answers.
const FORWARD_HEADER = /^(from|sent|to|cc|bcc|date|subject|reply to)$/;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** HTML email -> text with one line per paragraph / row and a tab between table cells. */
export function htmlToText(html) {
  return String(html || "")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e) => {
      if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1));
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}

// "Parent/Guardian Name" and "Parent or guardian name" both read as "parent name".
const labelKey = (label) => label.toLowerCase().replace(/[’'`]/g, "").replace(/[^a-z0-9]+/g, " ").trim()
  .replace(/\bparent (or )?guardian\b/g, "parent");

function fieldFor(label) {
  const key = labelKey(label);
  if (!key || FORWARD_HEADER.test(key)) return null;
  const hit = FIELD_LABELS.find(([, re]) => re.test(key));
  return hit ? hit[0] : null;
}

// "Label: value" or "Label<TAB>value" (a table row).
const LABEL_RE = /^([^:\t]{1,60}?)\s*(?::|\t)\s*(.*)$/;
// A line that starts a new answer: "Phone: ...", or a known label on its own.
const isLabelLine = (line) => !!fieldFor((line.match(LABEL_RE) || [])[1] || line);

/** [{label, value}] from the email text: "Label: value", "Label<TAB>value", or the value on the next line. */
export function labelledLines(text) {
  const lines = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/^[>\s]+/, "").replace(/[  ]+/g, " ").replace(/\t+/g, "\t").trim())
    .filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LABEL_RE);
    if (m) {
      const label = m[1].replace(/[*_]/g, "").trim();
      let value = m[2].replace(/\t+/g, " ").replace(/^[*_]+|[*_]+$/g, "").trim();
      // Value on the next line (label alone on its line), unless that line is a label itself.
      if (!value && fieldFor(label) && i + 1 < lines.length && !isLabelLine(lines[i + 1])) {
        value = lines[++i].replace(/\t+/g, " ").trim();
      }
      out.push({ label, value });
    } else if (fieldFor(lines[i]) && i + 1 < lines.length && !isLabelLine(lines[i + 1])) {
      out.push({ label: lines[i], value: lines[++i].replace(/\t+/g, " ").trim() });
    }
  }
  return out;
}

const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?\b/i;

/** "Saturday, November 21, 2026 at 10:00 AM - 11:00 AM" -> {date: "Saturday, November 21, 2026", time: "10:00 AM - 11:00 AM"} */
export function splitDateTime(value) {
  const text = String(value || "").trim();
  const m = text.match(TIME_RE);
  if (!m) return { date: text, time: "" };
  const date = text.slice(0, m.index).replace(/(\s+(at|@|from|-|,))+\s*$/i, "").replace(/,\s*$/, "").trim();
  const time = text.slice(m.index).replace(/\s*\(.*$/, "").replace(/\s+[A-Z]{2,4}$/, "").trim();
  return { date, time };
}

/** Whole years between a date of birth and today (YYYY-MM-DD), or "" if the date can't be read. */
export function ageFromBirthDate(value, todayISO) {
  const text = String(value || "").trim();
  let y, mo, d, m;
  if ((m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) [mo, d, y] = +m[1] > 12 ? [+m[2], +m[1], +m[3]] : [+m[1], +m[2], +m[3]];
  else {
    const t = Date.parse(text);
    if (isNaN(t)) return "";
    const dt = new Date(t);
    [y, mo, d] = [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()];
  }
  const [ty, tm, td] = todayISO.split("-").map(Number);
  const age = ty - y - (tm < mo || (tm === mo && td < d) ? 1 : 0);
  return age >= 0 && age < 30 ? String(age) : "";
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
// Addresses that send the notification, not the parent's.
const SYSTEM_SENDER = /no-?reply|do-?not-?reply|notifications?@|mailer|postmaster|bounce/i;
// The CRM's own domains: never the parent's address.
const CRM_DOMAINS = ["childcarecrm.com"];
const clip = (s, n) => String(s || "").trim().slice(0, n);

/**
 * The lead found in one email.
 *   mail: {subject, text, html, from, messageId}
 *   todayISO: "YYYY-MM-DD" (for working out an age from a date of birth)
 * Returns the lead's fields (blank when not found) plus inquiry_email (the original, for staff)
 * and inquiry_message_id (so the same email is never added twice).
 */
export function parseInquiryEmail(mail, todayISO) {
  const subject = clip(mail.subject, 300);
  const text = String(mail.text || "").trim() || htmlToText(mail.html);
  const found = {};
  const extras = [];
  for (const { label, value } of labelledLines(text)) {
    const field = fieldFor(label);
    if (!field || !value) continue;
    if (field === "comments" || field === "heard_from") {
      extras.push(field === "heard_from" ? `Heard about us: ${value}` : value);
      continue;
    }
    if (!(field in found)) found[field] = value;
  }

  const lead = {
    ninja_name: found.ninja_name || [found.ninja_first, found.ninja_last].filter(Boolean).join(" "),
    parent_name: found.parent_name || [found.parent_first, found.parent_last].filter(Boolean).join(" "),
    phone_number: found.phone_number || "",
    email: (found.email && (found.email.match(EMAIL_RE) || [""])[0]) || "",
    age: found.age ? (found.age.match(/\d{1,2}/) || [found.age])[0] : found.age_dob ? ageFromBirthDate(found.age_dob, todayISO) : "",
    gbs_type: found.gbs_type || "",
    coding_experience: found.coding_experience || "",
    comments: extras.join("\n"),
    gbs_date: found.gbs_date || "",
    gbs_time: found.gbs_time || "",
  };
  if (found.gbs_when) {
    const { date, time } = splitDateTime(found.gbs_when);
    if (!lead.gbs_date) lead.gbs_date = date;
    if (!lead.gbs_time) lead.gbs_time = time;
  }
  if (lead.gbs_date && !lead.gbs_time && TIME_RE.test(lead.gbs_date)) Object.assign(lead, (({ date, time }) => ({ gbs_date: date, gbs_time: time }))(splitDateTime(lead.gbs_date)));

  // The program from the opening sentence, e.g. ChildcareCRM's "submitted their information for your CORE programs".
  if (!lead.gbs_type) {
    const program = text.match(/\binformation for (?:your|our|the) (.{1,40}?) programs?\b/i);
    if (program) lead.gbs_type = program[1].trim();
  }

  // No labelled email / phone: take the first one in the text that isn't the CRM's (or the sender's) own,
  // e.g. not support@childcarecrm.com from the footer.
  if (!lead.email) {
    const ownDomains = [...String(mail.from || "").matchAll(new RegExp(EMAIL_RE.source, "gi"))]
      .map((m) => m[0].split("@")[1].toLowerCase()).concat(CRM_DOMAINS);
    const isOwn = (e) => { const d = e.split("@")[1].toLowerCase(); return ownDomains.some((o) => d === o || d.endsWith("." + o)); };
    const emails = text.match(new RegExp(EMAIL_RE.source, "gi")) || [];
    lead.email = emails.find((e) => !SYSTEM_SENDER.test(e) && !isOwn(e)) || "";
  }
  if (!lead.phone_number) lead.phone_number = (text.match(PHONE_RE) || [""])[0];

  for (const k of Object.keys(lead)) lead[k] = clip(lead[k], k === "comments" ? 4000 : 200);
  lead.inquiry_email = clip((subject ? `Subject: ${subject}\n\n` : "") + text, 20000);
  lead.inquiry_message_id = clip(mail.messageId, 300);
  return lead;
}

// ---------------------------------------------------------------------------------------------
// LineLeader "Daily Tour Email": sent the morning of the GBS, one email listing every tour that day:
//   "Here are your scheduled tours for today, Saturday, 21 November, 2026:"
//   "<Parent name> tour at 12:00pm with <Staff name>"
//   then (sometimes) Parent Information (Primary Phone / Primary Email ...) and Child Information,
//   one "Name: / Current Age: / Date of Birth:" block per child.
// Each tour becomes one entry per child, already carrying the GBS date, time and staff member.

const TOUR_LINE = /^([^:\t]+?)\s+tour at\s+(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)(?:\s+with\s+(.+?))?\s*$/i;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** True for LineLeader's daily list of tours (not a single new-family inquiry). */
export function isDailyTourEmail(mail) {
  const text = String(mail.text || "") || htmlToText(mail.html);
  return /daily tour email/i.test(String(mail.subject || "")) || /here are your scheduled tours for/i.test(text);
}

/** "Saturday, 21 November, 2026" (or "November 21, 2026") -> "2026-11-21"; "" if it can't be read. */
export function tourDateISO(value) {
  const t = String(value || "").toLowerCase();
  const y = (t.match(/\b(20\d\d)\b/) || [])[1];
  const mi = MONTHS.findIndex((m) => new RegExp(`\\b${m.slice(0, 3)}[a-z]*\\b`).test(t));
  const d = (t.replace(/\b20\d\d\b/, "").match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/) || [])[1];
  if (!y || mi < 0 || !d) return "";
  return `${y}-${String(mi + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "12:00pm" -> "12:00 PM", "4pm" -> "4:00 PM". */
const tidyTime = (t) => {
  const m = String(t).match(/(\d{1,2})(?::(\d{2}))?\s*([ap])/i);
  return m ? `${+m[1]}:${m[2] || "00"} ${m[3].toUpperCase()}M` : String(t).trim();
};

/**
 * Every tour in a Daily Tour Email:
 *   [{parent_name, staff_name, gbs_date, gbs_time, email, phone_number, children: [{name, age}], text}]
 * text is that tour's own part of the email (kept with the entry for staff).
 */
export function parseDailyTours(mail, todayISO) {
  const text = (String(mail.text || "").trim() || htmlToText(mail.html)).replace(/\r\n?/g, "\n");
  const lines = text.split("\n").map((l) => l.replace(/^[>\s]+/, "").replace(/[  ]+/g, " ").trim());
  const dateLine = text.match(/scheduled tours for (?:today,?\s*)?([^\n:]+?\d{4})/i);
  const gbs_date = (dateLine && tourDateISO(dateLine[1])) || todayISO || "";

  const tours = [];
  let tour = null, child = null;
  const value = (line) => line.replace(/^[^:]*:\s*/, "").replace(/\t+/g, " ").trim();
  for (const line of lines) {
    const t = line.match(TOUR_LINE);
    if (t) {
      tour = { parent_name: t[1].trim(), staff_name: (t[3] || "").trim(), gbs_date, gbs_time: tidyTime(t[2]),
        email: "", phone_number: "", children: [], lines: [line] };
      tours.push(tour);
      child = null;
      continue;
    }
    if (!tour) continue;
    tour.lines.push(line);
    // "Primary Phone: Primary Email: x@y.com" (an empty phone runs into the next label): read each label.
    // Labels start the line, except an email label right after the phone's (empty) value.
    // ("Preferred Name:" is not a new child: only "Name:" at the start of a line is.)
    for (const m of line.matchAll(/(?:^|(?<=\s))(Primary Phone|Primary Email|Alternate Phone|Alternate Email|Name|Current Age|Date of Birth)\s*:\s*((?:(?!(?:Primary|Alternate) (?:Phone|Email)\s*:).)*)/gi)) {
      if (m.index > 0 && !/email/i.test(m[1])) continue;
      const label = m[1].toLowerCase(), v = m[2].trim();
      if (label === "name") { child = { name: v, age: "" }; if (v) tour.children.push(child); }
      else if (label === "current age" && child && v) child.age = (v.match(/\d{1,2}/) || [""])[0];
      else if (label === "date of birth" && child && v && !child.age) child.age = ageFromBirthDate(v, todayISO);
      else if (label.endsWith("email") && v && !tour.email) tour.email = (v.match(EMAIL_RE) || [""])[0];
      else if (label.endsWith("phone") && v && !tour.phone_number) tour.phone_number = (v.match(PHONE_RE) || [v])[0];
    }
  }
  return tours.map(({ lines: ls, ...rest }) => ({ ...rest, text: ls.filter(Boolean).join("\n") }));
}

/**
 * One lead per child (or one with no child name when the tour lists none), ready for
 * supabase/schema.sql add_tour_lead(), which updates the family's existing lead or adds a new one.
 */
export function parseDailyTourEmail(mail, todayISO) {
  const subject = clip(mail.subject, 300);
  const messageId = clip(mail.messageId, 250);
  const out = [];
  parseDailyTours(mail, todayISO).forEach((tour, i) => {
    const kids = tour.children.length ? tour.children : [{ name: "", age: "" }];
    kids.forEach((kid, j) => out.push({
      ninja_name: clip(kid.name, 200), age: clip(kid.age, 200),
      parent_name: clip(tour.parent_name, 200), staff_name: clip(tour.staff_name, 200),
      phone_number: clip(tour.phone_number, 200), email: clip(tour.email, 200),
      gbs_date: tour.gbs_date, gbs_time: clip(tour.gbs_time, 200),
      inquiry_email: clip((subject ? `Subject: ${subject}\n\n` : "") + tour.text, 20000),
      // Same email delivered twice: each tour / child is still only added once.
      inquiry_message_id: messageId ? `${messageId}#tour${i + 1}-${j + 1}` : "",
    }));
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// CRM "Tour Reminder" (one GBS, sent ahead of it):
//   "This is a REMINDER for CN Oakville, ON that you have a scheduled Tour with <parent> on 11/25/2026
//    at 6:00pm.  <First> may be contacted at (905) 555-0101 or name@example.com."
// Like a daily tour: it updates the family's existing lead (add_tour_lead), never an inquiry.

const REMINDER_RE = /you have a scheduled tour with\s+(.+?)\s+on\s+([^\n]+?)\s+at\s+(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)/i;

/** True for the CRM's "Tour Reminder" email. */
export function isTourReminderEmail(mail) {
  const text = String(mail.text || "") || htmlToText(mail.html);
  return REMINDER_RE.test(text.replace(/\s+/g, " ")) || (/tour reminder/i.test(String(mail.subject || "")) && /scheduled tour with/i.test(text));
}

/** "11/25/2026" (month first, as the CRM writes it), "2026-11-25" or "November 25, 2026" -> "2026-11-25". */
function reminderDateISO(value) {
  const t = String(value || "").trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return tourDateISO(t);
}

/** The one tour in a Tour Reminder, as a lead for add_tour_lead (in a list, like parseDailyTourEmail). */
export function parseTourReminderEmail(mail) {
  const subject = clip(mail.subject, 300);
  const text = (String(mail.text || "").trim() || htmlToText(mail.html)).replace(/\r\n?/g, "\n");
  const flat = text.replace(/\s+/g, " ");
  const m = flat.match(REMINDER_RE);
  if (!m) return [];
  const after = flat.slice(m.index);
  const at = after.search(/may be contacted at/i);
  const contactText = at >= 0 ? after.slice(at, at + 250) : after.slice(0, 400);
  // Only the reminder sentences, without the long "Go to Task" / "Add to Calendar" tracking links.
  const shown = text.replace(/<https?:[^>\s]*>/g, "").replace(/https?:\/\/\S{120,}/g, "[link]").replace(/\n{3,}/g, "\n\n").trim();
  return [{
    ninja_name: "", age: "",
    parent_name: clip(m[1], 200), staff_name: "",
    phone_number: clip((contactText.match(PHONE_RE) || [""])[0], 200),
    email: clip((contactText.match(EMAIL_RE) || [""])[0], 200),
    gbs_date: reminderDateISO(m[2]), gbs_time: tidyTime(m[3]),
    inquiry_email: clip((subject ? `Subject: ${subject}\n\n` : "") + shown, 20000),
    inquiry_message_id: mail.messageId ? `${clip(mail.messageId, 250)}#reminder` : "",
  }];
}

// ---------------------------------------------------------------------------------------------
// CRM text message: "You have a new inbound text in CRM from <parent>! ... Text Information /
// From: / Subject: / Received: 2026/11/21 15:00 / Message Body / <the text> / [Click Here to Reply ...]".
// Kept apart from inquiries: it is saved as a message (lead_messages), not a lead.

/** True for the CRM's "new inbound text" email. */
export function isTextMessageEmail(mail) {
  const text = String(mail.text || "") || htmlToText(mail.html);
  return /new inbound text in CRM/i.test(text) || (/^\s*Text Information\s*$/im.test(text) && /^\s*Message Body\s*$/im.test(text));
}

const REPLY_TEXT = /click here to reply/i;

/** The CRM's "reply to this text" link (https only), from the HTML or a markdown-style / bare link in the text. */
function replyLink(mail) {
  const html = String(mail.html || "");
  for (const a of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (REPLY_TEXT.test(htmlToText(a[2]))) return htmlToText(a[1]).trim();
  }
  for (const line of String(mail.text || "").split(/\r?\n/)) {
    if (!REPLY_TEXT.test(line)) continue;
    const url = line.match(/https:\/\/[^\s)<>\]]+/);
    if (url) return url[0];
  }
  return "";
}

/**
 * The text message in one email:
 *   {from_name, received, body, reply_link, original, email_message_id}
 */
export function parseTextMessageEmail(mail) {
  const subject = clip(mail.subject, 300);
  const text = (String(mail.text || "").trim() || htmlToText(mail.html)).replace(/\r\n?/g, "\n");
  const lines = text.split("\n").map((l) => l.replace(/^[>\s]+/, "").replace(/[  ]+/g, " ").trim());
  // Only the "Text Information" part: a forwarded email's own From: (the CRM's automated address,
  // the same on every one) comes earlier and is not the family.
  const info = Math.max(0, lines.findIndex((l) => /^text information:?$/i.test(l)));
  const field = (name) => {
    const line = lines.slice(info).find((l) => new RegExp(`^${name}\\s*:`, "i").test(l));
    return line ? line.replace(/^[^:]*:\s*/, "").trim() : "";
  };
  const intro = text.match(/new inbound text in CRM from\s+(.+?)!/i);
  const looksAutomated = (name) => /@|no-?reply|notification|crm|lineleader/i.test(name);
  const start = lines.findIndex((l) => /^message body:?$/i.test(l));
  const body = [];
  if (start >= 0) {
    for (const line of lines.slice(start + 1)) {
      if (REPLY_TEXT.test(line)) break;
      body.push(line);
    }
  }
  // The original, without the long tracking links (the reply link is kept on its own).
  const original = text.replace(/\[?(Click Here to Reply[^\]\n]*)\]?\s*\(https?:[^)\s]*\)/gi, "[$1]").replace(/<?https?:\/\/\S{120,}>?/g, "[link]");
  return {
    // The family: from "new inbound text in CRM from <name>!", else Text Information's From:.
    from_name: clip([intro ? intro[1].trim() : "", field("From")].find((n) => n && !looksAutomated(n)) || "", 200),
    received: clip(field("Received"), 100),
    body: clip(body.join("\n").replace(/\n{3,}/g, "\n\n").trim(), 4000),
    reply_link: clip(replyLink(mail), 2000),
    original: clip((subject ? `Subject: ${subject}\n\n` : "") + original.trim(), 20000),
    email_message_id: clip(mail.messageId, 300),
  };
}
