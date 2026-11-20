// Leads from CRM inquiry emails: reading the email (supabase/functions/lead-inquiry/parse.js)
// and showing / completing inquiries in the app. All names and numbers below are made up.
import { check, finish } from "./helpers.mjs";
import { openDatabase, closeDatabase, conn } from "../js/core/db.js";
import { handleRequest } from "../js/api/index.js";
import { parseInquiryEmail, htmlToText, splitDateTime, ageFromBirthDate } from "../supabase/functions/lead-inquiry/parse.js";

const TODAY = "2026-11-20";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pick = (lead, keys) => Object.fromEntries(keys.map((k) => [k, lead[k]]));
const MAIN = ["ninja_name", "parent_name", "phone_number", "email", "age", "gbs_date", "gbs_time", "gbs_type"];

// ---- "Label: value" lines, as most CRM notifications send them
const plain = parseInquiryEmail({
  subject: "New Inquiry: Game Building Session",
  from: "CRM <no-reply@crm.example.com>",
  messageId: "<abc-1@crm.example.com>",
  text: [
    "You have a new inquiry!",
    "",
    "Parent First Name: Sam",
    "Parent Last Name: Brooks",
    "Email: sam.brooks@example.com",
    "Phone: (905) 555-0101",
    "Child's Name: Riley Brooks",
    "Child's Age: 8 years old",
    "Program of Interest: CREATE",
    "Preferred Date: Saturday, November 21, 2026",
    "Preferred Time: 10:00 AM",
    "Has your child coded before?: A little Scratch",
    "How did you hear about us?: Google",
    "Comments: Loves Minecraft.",
    "",
    "View in CRM: https://crm.example.com/leads/123",
  ].join("\n"),
}, TODAY);
check("label: value email", same(pick(plain, MAIN), {
  ninja_name: "Riley Brooks", parent_name: "Sam Brooks", phone_number: "(905) 555-0101", email: "sam.brooks@example.com",
  age: "8", gbs_date: "Saturday, November 21, 2026", gbs_time: "10:00 AM", gbs_type: "CREATE",
}), pick(plain, MAIN));
check("coding experience", plain.coding_experience === "A little Scratch", plain.coding_experience);
check("comments + how they heard about us", plain.comments === "Heard about us: Google\nLoves Minecraft.", plain.comments);
check("original email kept for staff", plain.inquiry_email.startsWith("Subject: New Inquiry: Game Building Session\n\nYou have a new inquiry!"));
check("message id kept (so it is only added once)", plain.inquiry_message_id === "<abc-1@crm.example.com>");

// ---- HTML table (label cell, value cell), date and time together, date of birth
const html = parseInquiryEmail({
  subject: "Website inquiry",
  html: `<html><head><style>td{color:red}</style></head><body><p>New lead from the website</p>
    <table><tr><th>Student Name</th><td>Jordan&nbsp;Lake</td></tr>
    <tr><td>Parent/Guardian Name</td><td>Pat Lake</td></tr>
    <tr><td>Mobile</td><td>905.555.0102</td></tr>
    <tr><td>E-mail Address</td><td><a href="mailto:pat@example.com">pat@example.com</a></td></tr>
    <tr><td>Date of Birth</td><td>2016-12-01</td></tr>
    <tr><td>Appointment</td><td>Fri, Nov 27, 2026 at 4:30 PM - 5:30 PM EST</td></tr>
    <tr><td>Message</td><td>Is parking free? &amp; is there a sibling discount?</td></tr></table></body></html>`,
}, TODAY);
check("HTML table email", same(pick(html, MAIN), {
  ninja_name: "Jordan Lake", parent_name: "Pat Lake", phone_number: "905.555.0102", email: "pat@example.com",
  age: "9", gbs_date: "Fri, Nov 27, 2026", gbs_time: "4:30 PM - 5:30 PM", gbs_type: "",
}), pick(html, MAIN));
check("HTML entities decoded in comments", html.comments === "Is parking free? & is there a sibling discount?", html.comments);
check("HTML email stored as readable text", html.inquiry_email.includes("Student Name\tJordan Lake") && !html.inquiry_email.includes("<td>"));

// ---- value on the line under its label; forwarded by Outlook (header block + quoted)
const forwarded = parseInquiryEmail({
  subject: "FW: New lead",
  from: "Front Desk <frontdesk@example.org>",
  text: [
    "________________________________",
    "From: CRM Notifications <notifications@crm.example.com>",
    "Sent: Thursday, November 19, 2026 3:12 PM",
    "To: Front Desk <frontdesk@example.org>",
    "Subject: New lead",
    "",
    "> Name",
    "> Lee Ash",
    "> Email",
    "> lee.ash@example.com",
    "> Child First Name",
    "> Quinn",
    "> Child Last Name",
    "> Ash",
    "> Age",
    "> 6",
  ].join("\n"),
}, TODAY);
check("label on one line, value on the next (forwarded)", same(pick(forwarded, MAIN), {
  ninja_name: "Quinn Ash", parent_name: "Lee Ash", phone_number: "", email: "lee.ash@example.com",
  age: "6", gbs_date: "", gbs_time: "", gbs_type: "",
}), pick(forwarded, MAIN));
check("the forward header's Sent date is not taken as the GBS date", forwarded.gbs_date === "");

// ---- nothing labelled: still picks up the parent's email and phone, never the CRM's own address
const loose = parseInquiryEmail({
  subject: "Inquiry",
  from: "no-reply@crm.example.com",
  text: "Hi, my son wants to try coding. Call me at 905-555-0177 or write to morgan.v@example.com. Sent via no-reply@crm.example.com",
}, TODAY);
check("unlabelled email + phone found", loose.email === "morgan.v@example.com" && loose.phone_number === "905-555-0177", loose);
check("child's name left blank when not found", loose.ninja_name === "");

// ---- helpers
check("date + time split", same(splitDateTime("Saturday, Nov 21 @ 10am"), { date: "Saturday, Nov 21", time: "10am" }));
check("date only stays as it is", same(splitDateTime("Nov 21, 2026"), { date: "Nov 21, 2026", time: "" }));
check("age from date of birth", ageFromBirthDate("2018-11-21", TODAY) === "7" && ageFromBirthDate("11/20/2018", TODAY) === "8");
check("unreadable date of birth -> blank", ageFromBirthDate("soon", TODAY) === "");
check("html to text: rows and cells", htmlToText("<tr><td>A</td><td>B</td></tr>") === "A\tB\t\n");
check("very long fields are cut", parseInquiryEmail({ text: "Comments: " + "x".repeat(9000) }, TODAY).comments.length === 4000);

// ---- in the app: an inquiry arrives (as sync would bring it in), is listed, then completed
openDatabase(null);
await handleRequest("POST", "/api/leads", { ninja_name: "Older Lead", phone_number: "905-555-0000" });
conn.run(`INSERT INTO leads (entry_number, ninja_name, parent_name, email, lead_date, inquiry_status, inquiry_email, inquiry_message_id)
  VALUES (2, 'Riley Brooks', 'Sam Brooks', 'sam.brooks@example.com', '2026-11-20', 'new', 'Subject: New Inquiry', '<abc-1>')`);
let leads = await handleRequest("GET", "/api/leads?sort=gbs");
const inq = leads.find((l) => l.ninja_name === "Riley Brooks");
check("inquiry comes back with its status and original email", inq.inquiry_status === "new" && inq.inquiry_email === "Subject: New Inquiry", inq);
check("normal leads have no inquiry status", !leads.find((l) => l.ninja_name === "Older Lead").inquiry_status);
// Editing keeps it an inquiry until someone marks it complete.
await handleRequest("PUT", `/api/leads/${inq.id}`, { ...inq, age: "8", gbs_date: "2026-11-21" });
leads = await handleRequest("GET", "/api/leads");
check("editing an inquiry keeps it marked new", leads.find((l) => l.id === inq.id).inquiry_status === "new");
await handleRequest("POST", `/api/leads/${inq.id}/inquiry-done`);
leads = await handleRequest("GET", "/api/leads");
const done = leads.find((l) => l.id === inq.id);
check("marked complete: now a normal lead, details kept", done.inquiry_status === "" && done.age === "8" && done.inquiry_email === "Subject: New Inquiry", done);
let missing = null;
try { await handleRequest("POST", "/api/leads/99999/inquiry-done"); } catch (e) { missing = e.message; }
check("completing a lead that is gone says so", missing === "That entry no longer exists.", missing);
closeDatabase();

finish("Inquiry emails");
