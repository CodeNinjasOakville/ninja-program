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

  // No labelled email / phone: take the first one in the text that isn't the CRM's own address.
  if (!lead.email) {
    const emails = text.match(new RegExp(EMAIL_RE.source, "gi")) || [];
    lead.email = emails.find((e) => !SYSTEM_SENDER.test(e) && !String(mail.from || "").toLowerCase().includes(e.toLowerCase())) || "";
  }
  if (!lead.phone_number) lead.phone_number = (text.match(PHONE_RE) || [""])[0];

  for (const k of Object.keys(lead)) lead[k] = clip(lead[k], k === "comments" ? 4000 : 200);
  lead.inquiry_email = clip((subject ? `Subject: ${subject}\n\n` : "") + text, 20000);
  lead.inquiry_message_id = clip(mail.messageId, 300);
  return lead;
}
