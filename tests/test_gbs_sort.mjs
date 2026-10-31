// Leads list order: upcoming GBS first (soonest at the top), then past (most recent first),
// then leads with no readable GBS date (newest lead first).
import { check, finish } from "./helpers.mjs";
import { parseGbsDate, gbsTimeMinutes, sortLeadsByGbs } from "../js/lib/gbs_sort.js";
import { openDatabase, closeDatabase } from "../js/core/db.js";
import { handleRequest } from "../js/api/index.js";

const TODAY = "2026-10-31";

// ---- reading typed dates
const dates = {
  "2026-11-03": "2026-11-03",
  "2026/11/3": "2026-11-03",
  "11/3/2026": "2026-11-03",
  "11/03/26": "2026-11-03",
  "11-3-2026": "2026-11-03",
  "25/11/2026": "2026-11-25",      // day first: 25 can't be a month
  "Nov 3, 2026": "2026-11-03",
  "November 3rd 2026": "2026-11-03",
  "Tue, Nov 3, 2026": "2026-11-03",
  "Tuesday November 3": "2026-11-03",
  "3 Nov 2026": "2026-11-03",
  "03-Nov-2026": "2026-11-03",
  "Nov 3": "2026-11-03",           // no year: the one nearest today
  "Jan 5": "2027-01-05",
  "Sep 20": "2026-09-20",
  "11/3": "2026-11-03",
  "2026-11-03 16:00": "2026-11-03",
  "2026-11-03T16:00:00": "2026-11-03",
  "46329": "2026-11-03",           // Excel day number
  "": "",
  "TBD": "",
  "not booked": "",
  "2/30/2026": "",                 // no such day
  "13/13/2026": "",
};
for (const [typed, want] of Object.entries(dates)) {
  const got = parseGbsDate(typed, TODAY);
  check(`reads "${typed}"`, got === want, { got, want });
}

const times = { "4 PM": 960, "4:30pm": 990, "16:30": 990, "4 PM - 5 PM": 960, "12 AM": 0, "12 PM": 720, "": 9999, "evening": 9999 };
for (const [typed, want] of Object.entries(times)) {
  check(`time "${typed}"`, gbsTimeMinutes(typed) === want, { got: gbsTimeMinutes(typed), want });
}

// ---- order
const leads = [
  { entry_number: 1, ninja_name: "Old No Date", gbs_date: "" },
  { entry_number: 2, ninja_name: "Last Month", gbs_date: "9/30/2026" },
  { entry_number: 3, ninja_name: "Next Week", gbs_date: "Nov 7, 2026" },
  { entry_number: 4, ninja_name: "Today Late", gbs_date: "2026-10-31", gbs_time: "6 PM" },
  { entry_number: 5, ninja_name: "Yesterday", gbs_date: "10/30/2026" },
  { entry_number: 6, ninja_name: "Today Early", gbs_date: "Oct 31", gbs_time: "4:30 PM" },
  { entry_number: 7, ninja_name: "Tomorrow", gbs_date: "2026-11-01" },
  { entry_number: 8, ninja_name: "New No Date", gbs_date: "TBD" },
];
const sorted = sortLeadsByGbs(leads, TODAY);
const names = sorted.map((r) => r.ninja_name);
const want = ["Today Early", "Today Late", "Tomorrow", "Next Week", "Yesterday", "Last Month", "New No Date", "Old No Date"];
check("upcoming soonest first, then past most recent first, then no date newest first",
  JSON.stringify(names) === JSON.stringify(want), { got: names, want });
check("each lead is tagged with its group",
  sorted.map((r) => r.gbs_group).join(",") === "upcoming,upcoming,upcoming,upcoming,past,past,none,none",
  sorted.map((r) => r.gbs_group));
check("the leads passed in are not changed", leads[0].gbs_group === undefined);

// ---- the route: ?sort=gbs only, plain order unchanged
openDatabase(null);
await handleRequest("POST", "/api/leads", { ninja_name: "Far Past", gbs_date: "2020-01-01" });
await handleRequest("POST", "/api/leads", { ninja_name: "Far Future", gbs_date: "2099-01-01" });
await handleRequest("POST", "/api/leads", { ninja_name: "Unbooked" });
const plain = (await handleRequest("GET", "/api/leads")).map((r) => r.ninja_name);
check("plain list stays in entry order", JSON.stringify(plain) === JSON.stringify(["Far Past", "Far Future", "Unbooked"]), plain);
const byGbs = (await handleRequest("GET", "/api/leads?sort=gbs")).map((r) => r.ninja_name);
check("?sort=gbs puts the upcoming GBS first", JSON.stringify(byGbs) === JSON.stringify(["Far Future", "Far Past", "Unbooked"]), byGbs);
const searched = (await handleRequest("GET", "/api/leads?sort=gbs&q=Far")).map((r) => r.ninja_name);
check("search results are sorted the same way", JSON.stringify(searched) === JSON.stringify(["Far Future", "Far Past"]), searched);
closeDatabase();

finish("GBS sort");
