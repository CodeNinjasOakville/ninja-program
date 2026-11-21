// Leads from CRM inquiry emails: reading the email (supabase/functions/lead-inquiry/parse.js)
// and showing / completing inquiries in the app. All names and numbers below are made up.
import { check, finish } from "./helpers.mjs";
import { openDatabase, closeDatabase, conn } from "../js/core/db.js";
import { handleRequest } from "../js/api/index.js";
import { parseInquiryEmail, htmlToText, splitDateTime, ageFromBirthDate,
  isDailyTourEmail, parseDailyTourEmail, tourDateISO,
  isTextMessageEmail, parseTextMessageEmail } from "../supabase/functions/lead-inquiry/parse.js";
import { sameParent } from "../js/api/leads.js";

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

// ---- ChildcareCRM "new family" email (the CRM this centre uses): label, then the value under it
const CCRM_INTRO = "Congratulations! A new family has submitted their information for your CORE programs.   " +
  "Please log into ChildcareCRM to view the full family record.  Here are a few details:";
const ccrmText = (email) => [CCRM_INTRO, "", "Parent Name", "", "Dana Cruz", "", "Email", "", email, "", "Phone number", "",
  "(905) 555-0150", "", "Questions? Contact support@childcarecrm.com"].join("\n");
const ccrmFrom = "ChildcareCRM <notifications@childcarecrm.com>";
const ccrm = parseInquiryEmail({ subject: "New Family Inquiry", from: ccrmFrom, text: ccrmText("dana.cruz@example.com") }, TODAY);
check("ChildcareCRM text email", same(pick(ccrm, MAIN), {
  ninja_name: "", parent_name: "Dana Cruz", phone_number: "(905) 555-0150", email: "dana.cruz@example.com",
  age: "", gbs_date: "", gbs_time: "", gbs_type: "CORE",
}), pick(ccrm, MAIN));
const ccrmHtml = parseInquiryEmail({ subject: "New Family Inquiry", from: ccrmFrom, html:
  `<p>${CCRM_INTRO}</p><p><b>Parent Name</b><br>Dana Cruz</p>` +
  `<p><b>Email</b><br><a href="mailto:dana.cruz@example.com">dana.cruz@example.com</a></p><p><b>Phone number</b><br>(905) 555-0150</p>` }, TODAY);
check("ChildcareCRM HTML email", same(pick(ccrmHtml, MAIN), pick(ccrm, MAIN)), pick(ccrmHtml, MAIN));
const ccrmNoEmail = parseInquiryEmail({ from: ccrmFrom, text: ccrmText("") }, TODAY);
check("no parent email: the CRM's support address is not used", ccrmNoEmail.email === "" && ccrmNoEmail.parent_name === "Dana Cruz", ccrmNoEmail);
const forwardedByStaff = parseInquiryEmail({ from: "Front Desk <frontdesk@example.org>",
  text: "From: ChildcareCRM <notifications@childcarecrm.com>\nTo: frontdesk@example.org\n\n" + ccrmText("") }, TODAY);
check("forwarded without a parent email: neither the CRM's nor our own address is used", forwardedByStaff.email === "", forwardedByStaff.email);

// ---- LineLeader "Daily Tour Email": every tour that day in one email, told apart from inquiries
const tourChild = (name, age, dob) => [`Name: ${name}`, "Preferred Name:", `Current Age: ${age}`, `Date of Birth: ${dob}`,
  "Gender:", "Expected Start Date:", "Comments:", "Child Schedule:", "Monday\tTuesday\tWednesday\tThursday\tFriday",
  "AM:\tN\tN\tN\tN\tN", "PM:\tN\tN\tN\tN\tN"];
const TOUR_TEXT = [
  "Good Morning Alex,", "", "We hope your day is off to a great start!",
  '"Procrastination is the thief of time, collar him." -Charles Dickens',
  "Here are your scheduled tours for today, Saturday, 21 November, 2026:",
  "Jamie Fox tour at 12:00pm with Robin Staff",
  "Parent Information",
  "Primary Phone: Primary Email: jamie.fox@example.com",
  "Alternate Phone:", "Alternate Email:", "Address:", "City:",
  "Inquiry Type: Web", "Lead Source: Import", "Relation to Child: Guardian", "Lead Comments:",
  "Child Information",
  ...tourChild("Blake Fox", 7, "2019-01-01"),
  ...tourChild("Ava Fox", 4, "2022-02-17"),
  "Casey Moon tour at 12:00pm with Robin Staff",
].join("\n");
const tourMail = { subject: "Lineleader Daily Tour Email", from: "LineLeader <no-reply@lineleader.example>", messageId: "<tour-1>", text: TOUR_TEXT };
check("daily tour email recognised", isDailyTourEmail(tourMail) && isDailyTourEmail({ text: TOUR_TEXT }));
check("inquiry email is not a tour email", !isDailyTourEmail({ subject: "New Family Inquiry", text: ccrmText("x@example.com") }));
const tourLeads = parseDailyTourEmail(tourMail, "2026-11-21");
const TOUR_KEYS = ["ninja_name", "age", "parent_name", "staff_name", "email", "phone_number", "gbs_date", "gbs_time"];
const fox = { parent_name: "Jamie Fox", staff_name: "Robin Staff", email: "jamie.fox@example.com", phone_number: "", gbs_date: "2026-11-21", gbs_time: "12:00 PM" };
check("one entry per child, plus one for the tour with no details", same(tourLeads.map((l) => pick(l, TOUR_KEYS)), [
  { ninja_name: "Blake Fox", age: "7", ...fox },
  { ninja_name: "Ava Fox", age: "4", ...fox },
  { ninja_name: "", age: "", parent_name: "Casey Moon", staff_name: "Robin Staff", email: "", phone_number: "", gbs_date: "2026-11-21", gbs_time: "12:00 PM" },
]), tourLeads.map((l) => pick(l, TOUR_KEYS)));
check("each tour keeps only its own part of the email",
  tourLeads[0].inquiry_email.includes("Jamie Fox tour at") && !tourLeads[0].inquiry_email.includes("Casey Moon")
  && tourLeads[2].inquiry_email === "Subject: Lineleader Daily Tour Email\n\nCasey Moon tour at 12:00pm with Robin Staff", tourLeads[2].inquiry_email);
check("each child has its own message id (added once each)",
  same(tourLeads.map((l) => l.inquiry_message_id), ["<tour-1>#tour1-1", "<tour-1>#tour1-2", "<tour-1>#tour2-1"]));
const tourHtml = parseDailyTourEmail({ subject: "Lineleader Daily Tour Email", html: "<p>" + TOUR_TEXT.split("\n").join("</p><p>") + "</p>" }, "2026-11-21");
check("HTML tour email reads the same", same(tourHtml.map((l) => pick(l, TOUR_KEYS)), tourLeads.map((l) => pick(l, TOUR_KEYS))), tourHtml.map((l) => pick(l, TOUR_KEYS)));
check("tour dates", tourDateISO("Saturday, 21 November, 2026") === "2026-11-21" && tourDateISO("Monday, December 7, 2026") === "2026-12-07" && tourDateISO("soon") === "");
const phoneTour = parseDailyTourEmail({ text: ["Here are your scheduled tours for today, Friday, 4 December, 2026:",
  "Lee Park tour at 4pm with Robin Staff", "Primary Phone: (905) 555-0123 Primary Email:", "Name: Sky Park", "Current Age:",
  "Date of Birth: 2018-01-01"].join("\n") }, "2026-12-04")[0];
check("phone, 4pm, and age from date of birth", phoneTour.phone_number === "(905) 555-0123" && phoneTour.email === ""
  && phoneTour.gbs_time === "4:00 PM" && phoneTour.age === "8" && phoneTour.gbs_date === "2026-12-04", phoneTour);

// ---- CRM "new inbound text" email: a message from a family, never an inquiry or a tour
const REPLY_URL = "https://u1.ct.example.net/ls/click?upn=" + "x".repeat(300);
const TEXT_MSG = ["Dear Robin Staff,",
  "You have a new inbound text in CRM from Jamie Tsui-Fox! For your convenience, the message is below.", "",
  `[Click Here to Reply to this Text in CRM](${REPLY_URL})`,
  "Text Information", "From: Jamie Tsui-Fox", "Subject:", "Received: 2026/11/21 15:00",
  "Message Body", "Yes, see you at noon!", "Can Ava come too?",
  `[Click Here to Reply to this Text in CRM](${REPLY_URL})`].join("\n");
const textMail = { subject: "New Text Message", messageId: "<txt-1>", text: TEXT_MSG };
check("text message email recognised (and not a tour)", isTextMessageEmail(textMail) && !isDailyTourEmail(textMail));
check("tour and inquiry emails are not text messages",
  !isTextMessageEmail(tourMail) && !isTextMessageEmail({ text: ccrmText("x@example.com") }) && !isTextMessageEmail({ text: plain.inquiry_email }));
const msg = parseTextMessageEmail(textMail);
check("text message read", same(pick(msg, ["from_name", "received", "body", "reply_link", "email_message_id"]), {
  from_name: "Jamie Tsui-Fox", received: "2026/11/21 15:00", body: "Yes, see you at noon!\nCan Ava come too?",
  reply_link: REPLY_URL, email_message_id: "<txt-1>" }), msg);
check("original kept without the long tracking links", msg.original.includes("Message Body\nYes, see you at noon!") && !msg.original.includes("xxxxxxxx"), msg.original);
const msgHtml = parseTextMessageEmail({ html:
  `<p>Dear Robin Staff,</p><p>You have a new inbound text in CRM from Jamie Tsui-Fox! For your convenience, the message is below.</p>` +
  `<p><a href="${REPLY_URL}&amp;a=1">Click Here to Reply to this Text in CRM</a></p><h3>Text Information</h3>` +
  `<p>From: Jamie Tsui-Fox<br>Subject:<br>Received: 2026/11/21 15:00</p><h3>Message Body</h3><p>Yes</p>` +
  `<p><a href="${REPLY_URL}">Click Here to Reply to this Text in CRM</a></p>` });
check("HTML text message", msgHtml.from_name === "Jamie Tsui-Fox" && msgHtml.body === "Yes" && msgHtml.reply_link === REPLY_URL + "&a=1", msgHtml);
check("from name taken from the opening line when there is no From:", parseTextMessageEmail({
  text: "You have a new inbound text in CRM from Lee Park!\nMessage Body\nOk" }).from_name === "Lee Park");
check("same parent: exact, case, hyphenated surname", sameParent("Jamie Tsui-Fox", "jamie  tsui-fox") && sameParent("Jamie Tsui-Fox", "Jamie Fox")
  && !sameParent("Jamie Tsui-Fox", "Jamie Park") && !sameParent("Jamie Tsui-Fox", "Jamie") && !sameParent("", "Jamie Fox"));

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

// ---- in the app: a text message arrives, shows with the family's lead, then is marked done
await handleRequest("POST", "/api/leads", { ninja_name: "Blake Fox", parent_name: "Jamie Fox", gbs_date: "2026-11-21", gbs_time: "12:00 PM" });
conn.run(`INSERT INTO lead_messages (from_name, received, body, reply_link, original, email_message_id)
  VALUES ('Jamie Tsui-Fox', '2026/11/21 15:00', 'Yes', 'https://example.com/r', 'Subject: x', '<txt-1>'),
         ('Unknown Person', '2026/11/21 16:00', 'Hi', '', '', '<txt-2>')`);
let messages = await handleRequest("GET", "/api/lead-messages");
check("new messages listed newest first, each with the family's lead", messages.length === 2 && messages[0].from_name === "Unknown Person"
  && messages[0].leads.length === 0 && messages[1].leads.map((l) => l.ninja_name).join() === "Blake Fox" && messages[1].body === "Yes", messages);
await handleRequest("POST", `/api/lead-messages/${messages[1].id}/done`);
messages = await handleRequest("GET", "/api/lead-messages");
check("done: off the list, still kept", messages.length === 1 && conn.get("SELECT status FROM lead_messages WHERE email_message_id = '<txt-1>'").status === "");
missing = null;
try { await handleRequest("POST", "/api/lead-messages/99999/done"); } catch (e) { missing = e.message; }
check("done on a message that is gone says so", missing === "That message no longer exists.", missing);
closeDatabase();

finish("Inquiry emails");
