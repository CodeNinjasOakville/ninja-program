// ================================================================
// STATE
// ================================================================

let settings = {};
let leadsSelected = new Set();
let leadsDuplicatesOnly = false;
let beltsSelected = new Set();
let activeSelected = new Set();
let editingActiveId = null;
let editingLeadId = null;
let editingBeltId = null;
let activeView = "schedule";
let activeRowsCache = [];
let beltsRowsCache = [];
let rewardsRowsCache = [];

const LEAD_FIELD_DEFS = [
  { id: "ninja_name", title: "Ninja Name", type: "text", full: true },
  { id: "parent_name", title: "Parent Name", type: "text" },
  { id: "phone_number", title: "Phone Number", type: "text" },
  { id: "email", title: "Email", type: "text" },
  { id: "age", title: "Age", type: "text" },
  { id: "gbs_type", title: "GBS Type", type: "select", settingsKey: "gbs_types" },
  { id: "staff_name", title: "Staff Name", type: "text" },
  { id: "coding_experience", title: "Coding Experience", type: "select", settingsKey: "coding_experience_options" },
  { id: "gbs_date", title: "GBS Date", type: "text" },
  { id: "gbs_time", title: "GBS Time", type: "text" },
  { id: "post_gbs_follow_up", title: "Post GBS Follow-up", type: "select", settingsKey: "follow_up_options" },
  { id: "gbs_completed", title: "GBS Completed", type: "select", settingsKey: "gbs_completed_options" },
  { id: "comments", title: "Comments", type: "text", full: true },
];

const SETTINGS_LABELS = {
  gbs_types: "GBS Types",
  coding_experience_options: "Coding Experience Options",
  follow_up_options: "Post GBS Follow-up Options",
  gbs_completed_options: "GBS Completed Options",
  belt_options: "Belt Colors (lowest to highest)",
  jr_skills: "JR skills checklist - one per line: Area: Skill | words to look for in notes",
};

// ================================================================
// HELPERS
// ================================================================

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  attrs = attrs || {};
  Object.keys(attrs).forEach((key) => {
    if (key === "text") node.textContent = attrs[key];
    else node.setAttribute(key, attrs[key]);
  });
  (children || []).forEach((child) => node.appendChild(child));
  return node;
}

// The "server" now lives in the browser (js/api/*). window.ninjaApi is installed by
// js/main.js after sign-in; it accepts the same paths the Flask routes had.
async function api(path, options) {
  const method = ((options && options.method) || "GET").toUpperCase();
  const body = options && options.body ? JSON.parse(options.body) : undefined;
  try {
    return await window.ninjaApi(method, path, body);
  } catch (error) {
    // This screen asked for something the rest of the app doesn't know: right after an update the
    // browser can still be using saved copies of some old files. Offer to load the new version.
    if (error && error.status === 404 && error.message === "Not found.") {
      offerLatestVersion();
      throw new Error("The app was just updated and this browser is still using part of the old version.");
    }
    throw error;
  }
}

let latestVersionOffered = false;
async function offerLatestVersion(whatFailed) {
  if (latestVersionOffered) return;
  latestVersionOffered = true;
  const ok = await confirmDialog(
    "Load the new version",
    "The app was updated, but this browser is still using some saved files from the old version, " +
      `so ${whatFailed || "that button couldn't work"}.\n\nLoad the new version now? It only takes a moment.`
  );
  if (ok) await loadLatestVersion();
  else latestVersionOffered = false;
}

// Re-download every file this page uses (skipping the browser's saved copies), then reload.
async function loadLatestVersion() {
  const urls = new Set([location.href.split("#")[0]]);
  performance.getEntriesByType("resource").forEach((entry) => {
    const url = new URL(entry.name);
    if (url.origin === location.origin && /\.(js|css|wasm|html)$/.test(url.pathname)) urls.add(url.href);
  });
  await Promise.all([...urls].map((url) => fetch(url, { cache: "reload" }).catch(() => null)));
  location.reload();
}

async function apiUpload(path, file) {
  return window.ninjaApi("POST", path, undefined, file);
}

// Generated PDFs come back as bytes; save them as a download (what the old
// "as_attachment" download link did).
function openDownload(result) {
  const url = URL.createObjectURL(new Blob([result.bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = result.filename || "download.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function showBanner(elId, message, type) {
  const banner = document.getElementById(elId);
  banner.textContent = message;
  banner.className = "banner show " + (type || "");
}

function hideBanner(elId) {
  const banner = document.getElementById(elId);
  banner.className = "banner";
}

// A banner with a one-line summary, a close button, and long lists folded into
// "show details" sections (closed until clicked) so they never cover the page.
// sections: [{ title, lines }] - empty ones are left out.
function showBannerWithDetails(elId, summary, sections, type) {
  const banner = document.getElementById(elId);
  banner.textContent = "";
  banner.className = "banner show " + (type || "");
  const close = el("button", { class: "banner-close", title: "Close", "aria-label": "Close", text: "×" });
  close.addEventListener("click", () => hideBanner(elId));
  banner.appendChild(el("div", { class: "banner-head" }, [el("span", { text: summary }), close]));
  sections.filter((section) => section.lines.length).forEach((section) => {
    banner.appendChild(el("details", { class: "banner-details" }, [
      el("summary", { text: `${section.title} (${section.lines.length})` }),
      el("div", { class: "banner-details-list", text: section.lines.join("\n") }),
    ]));
  });
}

// Result of a CSV import or bulk add: {successCount, errors, duplicates?}.
function showImportResult(elId, result, verb) {
  const duplicates = result.duplicates || [];
  const errors = result.errors || [];
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const parts = [`${count(result.successCount, "entry", "entries")} ${verb}.`];
  if (duplicates.length) parts.push(`${count(duplicates.length, "possible duplicate", "possible duplicates")} skipped.`);
  if (errors.length) parts.push(`${count(errors.length, "row", "rows")} could not be added.`);
  const type = duplicates.length || (errors.length && result.successCount > 0) ? "warning"
    : result.successCount > 0 ? "success" : "error";
  showBannerWithDetails(elId, parts.join(" "), [
    { title: "Possible duplicates skipped - check these by hand", lines: duplicates },
    { title: "Rows that could not be added", lines: errors },
  ], type);
}

function formatBeltName(belt) {
  if (!belt) return "";
  return belt.charAt(0).toUpperCase() + belt.slice(1).toLowerCase();
}

// ---- Reusable confirm modal ----

function confirmDialog(title, message) {
  return new Promise((resolve) => {
    document.getElementById("confirmModalTitle").textContent = title;
    document.getElementById("confirmModalMessage").textContent = message;
    const overlay = document.getElementById("confirmModalOverlay");
    overlay.classList.add("open");

    const okBtn = document.getElementById("confirmModalOk");
    const cancelBtn = document.getElementById("confirmModalCancel");

    function cleanup(result) {
      overlay.classList.remove("open");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}


// True when `search` appears in any of the values (case-insensitive). Used by the
// tabs that filter in the browser (Rewards, Reward History).
function matchesSearch(values, search) {
  const q = String(search || "").trim().toLowerCase();
  return !q || values.some((v) => String(v === null || v === undefined ? "" : v).toLowerCase().includes(q));
}

// ---- Totem tags (shared by every tab) ----

function uniqueNames(names) {
  const seen = new Set();
  const result = [];
  names.forEach((n) => {
    const name = String(n || "").trim();
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      result.push(name);
    }
  });
  return result;
}

// selectedNames: names of rows the user ticked (may be empty)
// allNames:      names of every row currently shown
async function printTotemTagsForNames(selectedNames, allNames, bannerId, listLabel) {
  hideBanner(bannerId);

  let names = uniqueNames(selectedNames);
  if (names.length === 0) {
    names = uniqueNames(allNames);
    if (names.length === 0) {
      showBanner(bannerId, "There are no Ninjas to print tags for.", "error");
      return;
    }
    const ok = await confirmDialog(
      "Print Totem Tags",
      `Nothing is selected, so this will print a tag for each of the ${names.length} Ninja${names.length === 1 ? "" : "s"} currently shown in ${listLabel}. Continue?`
    );
    if (!ok) return;
  }

  await generateTotemTagsByName(names, bannerId);
}

async function generateTotemTagsByName(names, bannerId) {
  try {
    const result = await api("/api/totem-tags", {
      method: "POST",
      body: JSON.stringify({ names }),
    });
    showBanner(
      bannerId,
      `Generated ${result.count} totem tag${result.count === 1 ? "" : "s"}. Downloading...`,
      "success"
    );
    openDownload(result);
    showTagBelts(names);
  } catch (error) {
    showBanner(bannerId, error.message, "error");
  }
}

// The tags themselves never change colour or wording - this is only an on-screen list of
// which belt each printed tag gets attached to.
async function showTagBelts(names) {
  let rows;
  try {
    rows = await api("/api/belts/current", { method: "POST", body: JSON.stringify({ names }) });
  } catch (error) {
    return; // the tags still printed; the belt list is a convenience
  }

  const counts = {};
  const tbody = document.querySelector("#tagBeltsTable tbody");
  tbody.innerHTML = "";
  rows.forEach((row, i) => {
    counts[row.belt] = (counts[row.belt] || 0) + 1;
    const beltCell = row.belt
      ? el("td", { text: row.belt })
      : el("td", { class: "belt-unknown", text: "Not recorded" });
    tbody.appendChild(el("tr", {}, [el("td", { text: String(i + 1) }), el("td", { class: "person-name", text: row.name }), beltCell]));
  });

  const order = (settings.belt_options || []).map((b) => formatBeltName(b));
  const summary = Object.keys(counts)
    .filter((belt) => belt)
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((belt) => `${belt}: ${counts[belt]}`);
  if (counts[""]) summary.push(`Not recorded: ${counts[""]}`);
  document.getElementById("tagBeltsSummary").textContent = summary.join("  \u00b7  ");
  tagBeltNames = rows.map((r) => r.name);
  hideBanner("tagBeltsBanner");
  document.getElementById("tagBeltsModalOverlay").classList.add("open");
}

let tagBeltNames = []; // names in the list above, in tag order

// The same list as a page to print: name as it is on the tag, belt and a colour swatch.
document.getElementById("tagBeltsPrint").addEventListener("click", async () => {
  const btn = document.getElementById("tagBeltsPrint");
  btn.disabled = true;
  try {
    const result = await api("/api/totem-tags/belt-sheet", { method: "POST", body: JSON.stringify({ names: tagBeltNames }) });
    openDownload(result);
    showBanner("tagBeltsBanner", "Belt list downloaded.", "success");
  } catch (error) {
    showBanner("tagBeltsBanner", error.message, "error");
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("tagBeltsClose").addEventListener("click", () => {
  document.getElementById("tagBeltsModalOverlay").classList.remove("open");
});

// ================================================================
// PAGES: Ninjas, Belts & Rewards (3 parts), Leads, Settings (+ account)
// ================================================================

const PAGE_PANELS = { ninjas: ["active"], rewards: ["rewards", "belts", "history", "prints"], leads: ["leads"], settings: ["settings", "security"] };
let rewardsPart = "rewards"; // which part of Belts & Rewards is showing
// The parts of Leads (tabs inside the page) and the element each one shows; see applyLeadsView.
const LEADS_VIEWS = { upcoming: "upcomingLeads", inquiries: "inquiryLeads", messages: "leadMessages", table: "leadsTableWrap" };
let leadsView = "upcoming";

function loadPanel(panel) {
  // Leads and Belts change when the roster does (enrolled badges, renamed Ninjas), so they reload too.
  if (panel === "leads") loadLeads();
  if (panel === "belts") loadBelts();
  if (panel === "rewards") loadRewards();
  if (panel === "history") loadHistory();
  if (panel === "prints") loadPrints();
  if (panel === "active") loadActiveNinjas();
}

function showPanels(panels) {
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", panels.includes(p.id.replace("tab-", ""))));
  panels.forEach(loadPanel);
}

function showPage(page) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.group === page));
  document.getElementById("rewardsSubtabs").style.display = page === "rewards" ? "flex" : "none";
  // Leads always opens on Upcoming GBS.
  if (page === "leads") { leadsView = "upcoming"; leadsDuplicatesOnly = false; applyLeadsView(); }
  showPanels(page === "rewards" ? [rewardsPart] : PAGE_PANELS[page]);
}

function showRewardsPart(part) {
  rewardsPart = part;
  document.querySelectorAll("#rewardsSubtabs .subtab-btn").forEach((b) => b.classList.toggle("active", b.dataset.panel === part));
  showPage("rewards");
}

document.querySelectorAll(".tab-btn").forEach((btn) => btn.addEventListener("click", () => showPage(btn.dataset.group)));
document.querySelectorAll("#rewardsSubtabs .subtab-btn").forEach((btn) => btn.addEventListener("click", () => showRewardsPart(btn.dataset.panel)));

// Drop-down menus ("Print", "More"): close after picking something, or when clicking elsewhere.
document.addEventListener("click", (e) => {
  document.querySelectorAll("details.menu[open]").forEach((menu) => {
    if (!menu.contains(e.target) || e.target.closest(".menu-items button")) menu.removeAttribute("open");
  });
});

// ================================================================
// NINJA PROFILE: everything every page knows about one Ninja, in one window
// ================================================================

let profileNinja = null; // the data shown

// A Ninja's name drawn as a link that opens their profile. Use uid when known, else the name.
function ninjaLink(name, uid) {
  const link = el("button", { class: "name-link", type: "button", title: "Open this Ninja's page", text: name || "" });
  link.addEventListener("click", (e) => {
    e.stopPropagation();
    openNinjaProfile({ uid, name });
  });
  return link;
}

function profileCard(title, children, emptyText) {
  const card = el("div", { class: "profile-card" }, [el("h3", { text: title })]);
  (children.length ? children : [el("div", { class: "muted", text: emptyText || "Nothing yet." })]).forEach((c) => card.appendChild(c));
  return card;
}

const shortDate = (value) => String(value || "").slice(0, 10);

async function openNinjaProfile({ uid, name }) {
  let ninja;
  try {
    if (!uid) uid = (await api("/api/ninjas/find?name=" + encodeURIComponent(name || ""))).uid;
    ninja = await api("/api/ninjas/" + encodeURIComponent(uid));
  } catch (error) {
    // e.g. a name on the Belts page for a child who was never on the roster
    await confirmDialog("No Ninja page", error.message);
    return;
  }
  profileNinja = ninja;
  hideBanner("profileError");
  document.getElementById("profileName").textContent = ninja.name;
  const enrolled = ninja.classes.length > 0;
  document.getElementById("profileSub").textContent =
    (ninja.belt ? `${ninja.belt} belt` : "No belt yet") + (enrolled ? "" : " · not enrolled in any class right now");

  // ---- What you can do
  const actions = document.getElementById("profileActions");
  actions.innerHTML = "";
  const action = (text, primary, fn) => {
    const b = el("button", { class: primary ? "btn-primary" : "btn-secondary", type: "button", text });
    b.addEventListener("click", () => { closeNinjaProfile(); fn(); });
    actions.appendChild(b);
  };
  const row = ninja.classes[0] ? { ...ninja.classes[0], name: ninja.name } : { name: ninja.name, ninja_uid: ninja.uid };
  action("Edit (name, parent, classes, belt)", false, () => openActiveModal(row));
  action("Record a belt-up", false, () => {
    openBeltModal(null);
    document.getElementById("bf_name").value = ninja.name;
    const old = (settings.belt_options || []).find((b) => b.toLowerCase() === String(ninja.belt || "").toLowerCase());
    if (old) document.getElementById("bf_old_belt").value = old;
  });
  if (ninja.owed) action("Give rewards", true, () => openGiveRewards(ninja.name, ninja.owed));
  action("Add a 3D print", false, () => openPrintModal(null, ninja.name));
  action("Print totem tag", false, () => generateTotemTagsByName([ninja.name], "activeImportBanner"));
  if (ninja.classes.some((c) => c.is_jr) || ninja.notes.length) action("JR notes", false, () => openJrNotes(ninja.name));

  // ---- What we know
  const body = document.getElementById("profileBody");
  body.innerHTML = "";

  const family = [];
  if (ninja.family) {
    const f = ninja.family;
    if (f.name) family.push(el("div", { class: "profile-big", text: f.name }));
    if (f.email) family.push(el("div", {}, [el("a", { href: "mailto:" + f.email, text: f.email })]));
    if (f.phone) family.push(el("div", {}, [el("a", { href: "tel:" + String(f.phone).replace(/[^\d+]/g, ""), text: f.phone })]));
    if (ninja.siblings.length) {
      const sibs = el("div", { class: "profile-line" }, [el("span", { class: "muted", text: "Brothers / sisters: " })]);
      ninja.siblings.forEach((s, i) => {
        if (i) sibs.appendChild(document.createTextNode(", "));
        sibs.appendChild(ninjaLink(s.name, s.uid));
      });
      family.push(sibs);
    }
  }
  ninja.leads.forEach((l) => family.push(el("div", { class: "muted profile-line",
    text: `Came from lead #${l.entry_number}` + (l.gbs_date ? ` (GBS ${l.gbs_date})` : "") })));
  body.appendChild(profileCard("Parent / family", family,
    "No parent details yet. Press Edit to add them (importing from MyStudio fills them in too)."));

  const classes = el("div", { class: "sessions-cell" });
  sortSessions(ninja.classes).forEach((c) => classes.appendChild(sessionPill(c)));
  body.appendChild(profileCard("Classes", ninja.classes.length ? [classes] : [], "Not in any class right now."));

  const belts = ninja.belts.slice().reverse().map((b) => el("div", { class: "profile-line", text:
    (b.old_belt ? `${b.old_belt} → ${b.new_belt}` : `Started at ${b.new_belt}`) + `   ${shortDate(b.created_at)}` }));
  body.appendChild(profileCard("Belt history", belts));

  const owed = [];
  if (ninja.owed) {
    [["ninja_bucks", "Ninja Buck", "Ninja Bucks"], ["prints", "3D print", "3D prints"], ["certificates", "certificate", "certificates"],
      ["belts", "new belt to hand out", "new belts to hand out"]]
      .forEach(([key, one, many]) => {
        const n = ninja.owed[key + "_remaining"];
        const printed = key === "certificates" && ninja.owed.certificates_printed ? ` (${ninja.owed.certificates_printed} printed, ready to hand out)` : "";
        if (n) owed.push(el("div", { class: "profile-line" }, [el("b", { text: String(n) }), document.createTextNode(" " + (n === 1 ? one : many) + printed)]));
      });
  } else {
    owed.push(el("div", { class: "muted", text: ninja.levels ? "All caught up." : "No belt-ups yet." }));
  }
  body.appendChild(profileCard("Rewards owed", owed));

  const given = ninja.given.slice(0, 8).map((r) => el("div", { class: "profile-line",
    text: `${shortDate(r.date)}  ${r.amount} × ${r.reward_type}` + (r.details ? ` (${r.details})` : "") }));
  if (ninja.given.length > 8) given.push(el("div", { class: "muted", text: `and ${ninja.given.length - 8} more (Belts & Rewards → Rewards given)` }));
  body.appendChild(profileCard("Rewards given", given));

  // 3D prints: the ones waiting (with their place in the whole queue), then the last few printed.
  const prints = [];
  ninja.prints.queued.forEach((p) => {
    const line = el("div", { class: "profile-print" + (p.position === 1 ? " print-next" : "") }, [
      el("div", {}, [el("b", { text: `#${p.position} in queue` }), document.createTextNode(`  ${printTitle(p)}`)]),
      el("div", { class: "muted", text: `promised ${p.promised_date}` + (p.waiting_days ? ` · waiting ${p.waiting_days} day${p.waiting_days === 1 ? "" : "s"}` : "") }),
      printModelCell(p, "profileError"),
    ]);
    const done = el("button", { class: "btn-secondary btn-small", type: "button", text: "✔ Printed" });
    done.addEventListener("click", () => openPrintedModal(p));
    line.appendChild(done);
    prints.push(line);
  });
  ninja.prints.printed.slice(0, 3).forEach((p) => prints.push(el("div", { class: "profile-line muted",
    text: `Printed ${p.printed_date}  ${printTitle(p)}` })));
  body.appendChild(profileCard("3D prints", prints, "No 3D prints queued. Use \"Add a 3D print\" when they pick one."));

  if (ninja.notes.length || ninja.classes.some((c) => c.is_jr)) {
    const notes = ninja.notes.slice(0, 3).map((n) => el("div", { class: "profile-line",
      text: `${shortDate(n.created_at)}  ${n.note}` + (n.author ? ` — ${n.author}` : "") }));
    body.appendChild(profileCard("JR skills", [jrSkillSummary(ninja.jr.summary, "Nothing yet. Notes and the checklist (JR notes button) fill this in.")]));
    body.appendChild(profileCard("JR notes (what they're working on)", notes));
  }

  document.getElementById("ninjaProfileOverlay").classList.add("open");
}

function closeNinjaProfile() {
  document.getElementById("ninjaProfileOverlay").classList.remove("open");
}
document.getElementById("profileClose").addEventListener("click", closeNinjaProfile);
document.getElementById("ninjaProfileOverlay").addEventListener("click", (e) => {
  if (e.target.id === "ninjaProfileOverlay") closeNinjaProfile(); // click outside the window
});

// ================================================================
// ACTIVE NINJAS
// ================================================================

function populateActiveDayDropdown(select, selectedValue) {
  select.innerHTML = "";
  select.appendChild(el("option", { value: "", text: "-- Select --" }));
  (settings.schedule_days || []).forEach((day) => {
    const opt = el("option", { value: day, text: day });
    if (day === selectedValue) opt.setAttribute("selected", "selected");
    select.appendChild(opt);
  });
}

// Pull a sortable "minutes since midnight" out of a slot like "4 PM - 5 PM"
// or "4:30pm". Slots with no recognizable time sort last.
function timeSlotSortKey(slot) {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(slot || "");
  if (!m) return 99999;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  let meridiem = (m[3] || "").toLowerCase();
  if (!meridiem) {
    // "4 - 5 PM" style: borrow AM/PM from later in the string.
    const later = /(am|pm)/i.exec(slot);
    meridiem = later ? later[1].toLowerCase() : "";
  }
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function setActiveView(view) {
  activeView = view;
  document.getElementById("viewScheduleBtn").classList.toggle("active", view === "schedule");
  document.getElementById("viewListBtn").classList.toggle("active", view === "list");
  document.getElementById("activeSchedule").style.display = view === "schedule" ? "grid" : "none";
  document.getElementById("activeListWrap").style.display = view === "list" ? "block" : "none";
  document.getElementById("viewJrBtn").classList.toggle("active", view === "jr");
  document.getElementById("activeJr").style.display = view === "jr" ? "grid" : "none";
  if (view === "jr") loadJrView();
}

function personKey(name) {
  return String(name || "").trim().toLowerCase();
}

function sortSessions(sessions) {
  return sessions
    .slice()
    .sort((a, b) => dayIndex(a.day) - dayIndex(b.day) || timeSlotSortKey(a.time_slot) - timeSlotSortKey(b.time_slot));
}

// "Monday" -> "Mon"; anything that isn't a normal weekday is shown as typed.
function shortDay(day) {
  const d = String(day || "").trim();
  return /^(mon|tue|wed|thu|fri|sat|sun)/i.test(d) ? d.slice(0, 3) : d || "No day";
}

function sessionLabel(r) {
  return `${shortDay(r.day)} ${r.time_slot || "no time"}`.trim();
}

// "Grace Lee · lee@x.com · 905-555-0101" for a class row (family details come with each row).
function parentLine(r) {
  return [r.family_name, r.family_email, r.family_phone].filter((v) => v && String(v).trim()).join(" · ");
}

// "Mon 4 PM" pill with the AI / JR badges.
function sessionPill(r) {
  const pill = el("span", { class: "session-pill" + (r.is_ai ? " ai" : "") + (r.is_jr ? " jr" : ""), text: sessionLabel(r) });
  if (r.is_ai) pill.appendChild(el("span", { class: "ai-badge", text: "AI" }));
  if (r.is_jr) pill.appendChild(el("span", { class: "jr-badge", text: "JR" }));
  return pill;
}

// Every Ninja's sessions, keyed by name - always from the full roster so a search
// doesn't hide the other classes a Ninja takes.
function groupSessionsByPerson(rows) {
  const byPerson = {};
  rows.forEach((r) => {
    const key = personKey(r.name);
    (byPerson[key] = byPerson[key] || []).push(r);
  });
  Object.keys(byPerson).forEach((key) => { byPerson[key] = sortSessions(byPerson[key]); });
  return byPerson;
}

function renderActiveSchedule(rows, allRows) {
  const container = document.getElementById("activeSchedule");
  container.innerHTML = "";

  const knownDays = settings.schedule_days || [];
  const sessionsByName = groupSessionsByPerson(allRows);
  const byDay = {};
  rows.forEach((row) => {
    const day = row.day && row.day.trim() ? row.day.trim() : "Unscheduled";
    (byDay[day] = byDay[day] || []).push(row);
  });

  // Weekdays in Settings order that actually have Ninjas, then any
  // unexpected day text, then Unscheduled last.
  const dayOrder = knownDays.filter((d) => byDay[d]);
  Object.keys(byDay).forEach((d) => {
    if (!dayOrder.includes(d) && d !== "Unscheduled") dayOrder.push(d);
  });
  if (byDay["Unscheduled"]) dayOrder.push("Unscheduled");

  dayOrder.forEach((day) => {
    const dayRows = byDay[day];
    const col = el("div", { class: "day-col" });

    const head = el("div", { class: "day-head" });
    head.appendChild(el("span", { class: "day-name", text: day }));
    const headRight = el("span", { class: "day-head-right" });
    const dayTagBtn = el("button", { class: "day-tag-btn", title: `Print totem tags for ${day}`, text: "Print Tags" });
    dayTagBtn.addEventListener("click", () => {
      generateTotemTagsByName(uniqueNames(dayRows.map((r) => r.name)), "activeImportBanner");
    });
    headRight.appendChild(dayTagBtn);
    headRight.appendChild(el("span", { class: "day-count", text: String(dayRows.length) }));
    head.appendChild(headRight);
    col.appendChild(head);

    const bySlot = {};
    dayRows.forEach((row) => {
      const slot = row.time_slot && row.time_slot.trim() ? row.time_slot.trim() : "No time set";
      (bySlot[slot] = bySlot[slot] || []).push(row);
    });

    Object.keys(bySlot)
      .sort((a, b) => timeSlotSortKey(a) - timeSlotSortKey(b) || a.localeCompare(b))
      .forEach((slot) => {
        const block = el("div", { class: "slot-block" });
        block.appendChild(el("div", { class: "slot-time", text: slot }));

        // Artificial Intelligence sessions first, then JR, then alphabetical.
        bySlot[slot]
          .sort((a, b) => (b.is_ai - a.is_ai) || (b.is_jr - a.is_jr) || a.name.localeCompare(b.name))
          .forEach((row) => {
            const key = personKey(row.name);
            const chip = el("div", {
              class: "ninja-chip" + (row.is_ai ? " ai" : "") + (row.is_jr ? " jr" : ""), "data-person": key,
            });
            if (parentLine(row)) chip.title = "Parent: " + parentLine(row);
            const label = el("span", { class: "chip-name" });
            label.appendChild(ninjaLink(row.name, row.ninja_uid));
            if (row.is_ai) label.appendChild(el("span", { class: "ai-badge", text: "AI" }));
            if (row.is_jr) label.appendChild(el("span", { class: "jr-badge", text: "JR" }));

            // Spell out the Ninja's other classes right on the chip.
            const others = (sessionsByName[key] || []).filter((r) => r.id !== row.id);
            if (others.length) {
              label.appendChild(el("span", {
                class: "chip-also",
                text: "Also: " + others.map((r) => sessionLabel(r) + (r.is_ai ? " (AI)" : "") + (r.is_jr ? " (JR)" : "")).join(", "),
              }));
              // Hovering one chip highlights the same Ninja's other classes.
              chip.addEventListener("mouseenter", () => {
                container.querySelectorAll(".ninja-chip").forEach((c) => {
                  c.classList.toggle("same-person", c.dataset.person === key);
                });
              });
              chip.addEventListener("mouseleave", () => {
                container.querySelectorAll(".ninja-chip.same-person").forEach((c) => c.classList.remove("same-person"));
              });
            }
            chip.appendChild(label);

            const actions = el("span", { class: "chip-actions" });
            if (row.is_jr) {
              const notesBtn = el("button", { class: "btn-icon btn-edit", title: "JR notes: what they're working on", text: "\ud83d\udcdd" });
              notesBtn.addEventListener("click", () => openJrNotes(row.name));
              actions.appendChild(notesBtn);
            }
            const editBtn = el("button", { class: "btn-icon btn-edit", title: "Edit / move", text: "\u270e" });
            editBtn.addEventListener("click", () => openActiveModal(row));
            const delBtn = el("button", { class: "btn-icon", title: "Remove", text: "\u2716" });
            delBtn.addEventListener("click", async () => {
              const message = others.length
                ? `Remove only ${row.name}'s ${sessionLabel(row)} class? Their other ${others.length} class${others.length === 1 ? "" : "es"} will stay.`
                : `Remove "${row.name}" from the active roster?`;
              const ok = await confirmDialog("Remove Entry", message);
              if (!ok) return;
              await api(`/api/active-ninjas/${row.id}`, { method: "DELETE" });
              loadActiveNinjas();
            });
            actions.appendChild(editBtn);
            actions.appendChild(delBtn);
            chip.appendChild(actions);

            block.appendChild(chip);
          });

        col.appendChild(block);
      });

    container.appendChild(col);
  });
}

// ---- Belts shared with the Belt-ups list (rules in js/lib/belt_match.js) ----

let beltQuestions = [];         // Belts-tab names that match more than one Active Ninja
let beltQuestionsShown = false; // the chooser opens by itself once; after "Later" only the banner shows

// Fills blank Active Ninja belts from the Belt-ups list and asks about names that could be several Ninjas.
async function syncActiveBelts(choices) {
  let result;
  try {
    result = await api("/api/active-ninjas/belt-matches", { method: "POST", body: JSON.stringify({ choices: choices || {} }) });
  } catch (error) {
    return; // the roster still shows; belts fill in next time
  }
  beltQuestions = result.questions;
  document.getElementById("activeBeltBanner").style.display = beltQuestions.length ? "flex" : "none";
  document.getElementById("activeBeltBannerText").textContent =
    `${beltQuestions.length} name${beltQuestions.length === 1 ? "" : "s"} in the Belt-ups list match more than one Ninja here. ` +
    "Choose who each belt belongs to.";
  if (result.filled.length) {
    showBanner(
      "activeImportBanner",
      "Belts updated from the Belt-ups list: " +
        result.filled.map((f) => (f.was ? `${f.name} (${f.was} \u2192 ${f.belt})` : `${f.name} (${f.belt})`)).join(", "),
      "success"
    );
  }
  if (beltQuestions.length && !beltQuestionsShown) openBeltMatchModal();
}

// ---- Ninjas with no belt yet: a banner, and one window to fill them all in ----

let missingBeltPeople = []; // [{uid, name, sessions}]

function showMissingBelts(allRows) {
  if (document.getElementById("activeSearch").value.trim()) return; // only judge the whole roster
  const byNinja = new Map();
  allRows.forEach((r) => {
    const key = r.ninja_uid || personKey(r.name);
    if (!byNinja.has(key)) byNinja.set(key, { uid: r.ninja_uid, name: r.name, belt: "", sessions: [] });
    const p = byNinja.get(key);
    p.sessions.push(r);
    if (r.belt) p.belt = r.belt;
  });
  missingBeltPeople = [...byNinja.values()].filter((p) => !p.belt && p.uid).sort((a, b) => a.name.localeCompare(b.name));
  const n = missingBeltPeople.length;
  document.getElementById("missingBeltBanner").style.display = n ? "flex" : "none";
  document.getElementById("missingBeltBannerText").textContent =
    `${n} Ninja${n === 1 ? " has" : "s have"} no belt yet (MyStudio's export doesn't include belts).`;
}

document.getElementById("missingBeltBtn").addEventListener("click", () => {
  hideBanner("beltFillError");
  const list = document.getElementById("beltFillList");
  list.innerHTML = "";
  const belts = (settings.belt_options || []).map((b) => formatBeltName(String(b).trim())).filter(Boolean);
  missingBeltPeople.forEach((p) => {
    const select = el("select");
    select.appendChild(el("option", { value: "", text: "-" }));
    belts.forEach((b) => select.appendChild(el("option", { value: b, text: b })));
    p.select = select;
    const sessions = el("span", { class: "sessions-cell" });
    sortSessions(p.sessions).forEach((r) => sessions.appendChild(sessionPill(r)));
    list.appendChild(el("div", { class: "review-row" }, [el("span", { class: "person-name", text: p.name }), select, sessions]));
  });
  document.getElementById("beltFillModalOverlay").classList.add("open");
});

document.getElementById("beltFillCancel").addEventListener("click", () => {
  document.getElementById("beltFillModalOverlay").classList.remove("open");
});

document.getElementById("beltFillSubmit").addEventListener("click", async () => {
  const picked = missingBeltPeople.filter((p) => p.select && p.select.value).map((p) => ({ uid: p.uid, belt: p.select.value }));
  if (!picked.length) {
    showBanner("beltFillError", "Pick a belt for at least one Ninja.", "error");
    return;
  }
  const btn = document.getElementById("beltFillSubmit");
  btn.disabled = true;
  try {
    const r = await api("/api/ninjas/belts", { method: "POST", body: JSON.stringify({ belts: picked }) });
    document.getElementById("beltFillModalOverlay").classList.remove("open");
    const saved = r.startingBelts + r.beltUps.length + r.beltsCorrected;
    showBanner("activeImportBanner", `${saved} belt${saved === 1 ? "" : "s"} saved.`, "success");
    loadActiveNinjas({ skipBeltSync: true });
  } catch (error) {
    showBanner("beltFillError", error.message, "error");
  } finally {
    btn.disabled = false;
  }
});

function openBeltMatchModal() {
  beltQuestionsShown = true;
  hideBanner("beltMatchError");
  const list = document.getElementById("beltMatchList");
  list.innerHTML = "";
  beltQuestions.forEach((q, i) => {
    list.appendChild(el("div", { class: "review-head", text: `"${q.belt_name}" - ${q.belt} belt in the Belt-ups list` }));
    const options = el("div", { class: "review-list" });
    const choice = (value, text) =>
      el("label", { class: "review-row" }, [el("input", { type: "radio", name: "beltMatch" + i, value }), el("span", { text })]);
    q.candidates.forEach((c) => {
      options.appendChild(choice(c.name, c.belt ? `${c.name} (already ${c.belt} - keeps it)` : `${c.name} (no belt yet)`));
    });
    options.appendChild(choice("", "None of these"));
    list.appendChild(options);
  });
  document.getElementById("beltMatchModalOverlay").classList.add("open");
}

document.getElementById("activeBeltReviewBtn").addEventListener("click", openBeltMatchModal);

document.getElementById("beltMatchCancel").addEventListener("click", () => {
  document.getElementById("beltMatchModalOverlay").classList.remove("open");
});

document.getElementById("beltMatchSubmit").addEventListener("click", async () => {
  const choices = {};
  beltQuestions.forEach((q, i) => {
    const picked = document.querySelector(`#beltMatchList input[name="beltMatch${i}"]:checked`);
    if (picked) choices[q.belt_name] = picked.value;
  });
  if (!Object.keys(choices).length) {
    showBanner("beltMatchError", 'Pick a Ninja (or "None of these") for at least one name.', "error");
    return;
  }
  document.getElementById("beltMatchModalOverlay").classList.remove("open");
  await syncActiveBelts(choices);
  loadActiveNinjas({ skipBeltSync: true });
});

async function loadActiveNinjas(options) {
  if (!(options && options.skipBeltSync)) await syncActiveBelts();
  const search = document.getElementById("activeSearch").value;
  const rows = await api("/api/active-ninjas?q=" + encodeURIComponent(search));
  const allRows = search.trim() ? await api("/api/active-ninjas") : rows;
  activeRowsCache = rows;
  const tbody = document.querySelector("#activeTable tbody");
  tbody.innerHTML = "";

  const sessionsByName = groupSessionsByPerson(allRows);
  // List view: one row per Ninja (only those matching the search), sorted by name.
  const people = uniqueNames(rows.map((r) => r.name))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, sessions: sessionsByName[personKey(name)] || [] }));

  document.getElementById("activeEmpty").style.display = rows.length ? "none" : "block";
  document.getElementById("activeCountLabel").textContent = rows.length
    ? `${people.length} Ninja${people.length === 1 ? "" : "s"}, ${rows.length} class${rows.length === 1 ? "" : "es"} shown`
    : "";

  renderActiveSchedule(rows, allRows);
  setActiveView(activeView);
  showMissingBelts(allRows);

  const visibleIds = new Set(allRows.map((r) => r.id));
  activeSelected = new Set([...activeSelected].filter((id) => visibleIds.has(id)));

  people.forEach((person) => {
    const ids = person.sessions.map((r) => r.id);
    const tr = el("tr");

    const checkbox = el("input", { type: "checkbox" });
    checkbox.checked = ids.length > 0 && ids.every((id) => activeSelected.has(id));
    checkbox.addEventListener("change", () => {
      ids.forEach((id) => (checkbox.checked ? activeSelected.add(id) : activeSelected.delete(id)));
      updateActiveSelectionUI();
    });
    tr.appendChild(el("td", {}, [checkbox]));

    tr.appendChild(el("td", { class: "person-name" }, [ninjaLink(person.name, (person.sessions[0] || {}).ninja_uid)]));
    const first = person.sessions[0] || {};
    const parentCell = el("td", { class: "parent-cell" });
    if (first.family_name || first.family_email || first.family_phone) {
      parentCell.appendChild(el("span", { text: first.family_name || "" }));
      const contact = [first.family_email, first.family_phone].filter(Boolean).join(" · ");
      if (contact) parentCell.appendChild(el("span", { class: "muted", text: contact }));
    } else {
      parentCell.appendChild(el("span", { class: "belt-unknown", text: "—" }));
    }
    tr.appendChild(parentCell);
    const belt = (person.sessions.find((r) => r.belt) || {}).belt;
    tr.appendChild(belt ? el("td", { text: belt }) : el("td", { class: "belt-unknown", text: "\u2014" }));
    tr.appendChild(el("td", { class: "class-count", text: String(person.sessions.length) }));

    const sessionsCell = el("td", { class: "sessions-cell" });
    person.sessions.forEach((r) => sessionsCell.appendChild(sessionPill(r)));
    tr.appendChild(sessionsCell);

    const actionsCell = el("td", { class: "actions-cell" });

    const editBtn = el("button", { class: "btn-icon btn-edit", title: "Edit name / classes", text: "\u270e" });
    editBtn.addEventListener("click", () => openActiveModal(person.sessions[0]));
    actionsCell.appendChild(editBtn);

    const delBtn = el("button", { class: "btn-icon", title: "Remove (all classes)", text: "\u2716" });
    delBtn.addEventListener("click", async () => {
      const message = ids.length > 1
        ? `Remove "${person.name}" and all ${ids.length} of their classes from the active roster?`
        : `Remove "${person.name}" from the active roster?`;
      const ok = await confirmDialog("Remove Ninja", message);
      if (!ok) return;
      await api("/api/active-ninjas/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) });
      ids.forEach((id) => activeSelected.delete(id));
      loadActiveNinjas();
    });
    actionsCell.appendChild(delBtn);

    tr.appendChild(actionsCell);
    tbody.appendChild(tr);
  });

  document.getElementById("activeSelectAll").checked =
    people.length > 0 && people.every((p) => p.sessions.every((r) => activeSelected.has(r.id)));

  updateActiveSelectionUI();
}

document.getElementById("viewScheduleBtn").addEventListener("click", () => setActiveView("schedule"));
document.getElementById("viewListBtn").addEventListener("click", () => setActiveView("list"));

function updateActiveSelectionUI() {
  const count = activeSelected.size;
  const ninjas = new Set(activeRowsCache.filter((r) => activeSelected.has(r.id)).map((r) => personKey(r.name))).size;
  document.getElementById("activeSelectionCount").textContent =
    count > 0 ? `${ninjas || count} Ninja${(ninjas || count) === 1 ? "" : "s"} selected` : "";
  document.getElementById("deleteSelectedActiveBtn").style.display =
    count > 0 ? "inline-block" : "none";
}

document.getElementById("activeSearch").addEventListener("input", () => loadActiveNinjas({ skipBeltSync: true }));

document.getElementById("activeSelectAll").addEventListener("change", (e) => {
  if (e.target.checked) {
    document.querySelectorAll("#activeTable tbody tr input[type=checkbox]").forEach((cb) => {
      cb.checked = true;
      cb.dispatchEvent(new Event("change"));
    });
  } else {
    activeSelected.clear();
    updateActiveSelectionUI();
    document.querySelectorAll("#activeTable tbody tr input[type=checkbox]").forEach((cb) => {
      cb.checked = false;
    });
  }
});

document.getElementById("deleteSelectedActiveBtn").addEventListener("click", async () => {
  const count = activeSelected.size;
  const ok = await confirmDialog(
    "Delete Selected",
    `Permanently remove the selected Ninjas (${count} class${count === 1 ? "" : "es"} in total) from the active roster? This cannot be undone.`
  );
  if (!ok) return;
  await api("/api/active-ninjas/bulk-delete", {
    method: "POST",
    body: JSON.stringify({ ids: [...activeSelected] }),
  });
  activeSelected.clear();
  loadActiveNinjas();
});

document.getElementById("deleteAllActiveBtn").addEventListener("click", async () => {
  const ok = await confirmDialog(
    "Delete ALL Active Ninjas",
    "This permanently deletes the entire active roster. This cannot be undone. Are you sure?"
  );
  if (!ok) return;
  const ok2 = await confirmDialog(
    "Are you REALLY sure?",
    "Last check - this deletes everything in the Ninjas pagele. Continue?"
  );
  if (!ok2) return;
  await api("/api/active-ninjas/bulk-delete", { method: "POST", body: JSON.stringify({ all: true }) });
  activeSelected.clear();
  loadActiveNinjas();
});

document.getElementById("printTotemTagsActiveBtn").addEventListener("click", () => {
  printTotemTagsForNames(
    activeRowsCache.filter((r) => activeSelected.has(r.id)).map((r) => r.name),
    activeRowsCache.map((r) => r.name),
    "activeImportBanner",
    "the Active Ninjas list"
  );
});

// A page of names and belts: the ticked Ninjas, or everyone currently shown.
document.getElementById("printBeltListActiveBtn").addEventListener("click", async () => {
  hideBanner("activeImportBanner");
  const picked = uniqueNames(activeRowsCache.filter((r) => activeSelected.has(r.id)).map((r) => r.name));
  const names = picked.length ? picked : uniqueNames(activeRowsCache.map((r) => r.name));
  if (!names.length) {
    showBanner("activeImportBanner", "There are no Ninjas to list.", "error");
    return;
  }
  try {
    const result = await api("/api/totem-tags/belt-sheet", { method: "POST", body: JSON.stringify({ names, standalone: true }) });
    openDownload(result);
    showBanner("activeImportBanner", `Belt list for ${result.count} Ninja${result.count === 1 ? "" : "s"} downloaded.`, "success");
  } catch (error) {
    showBanner("activeImportBanner", error.message, "error");
  }
});

// ---- Import CSV (Active Ninjas) ----

document.getElementById("importActiveBtn").addEventListener("click", () => {
  document.getElementById("importActiveFile").click();
});

document.getElementById("importActiveFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  hideBanner("activeImportBanner");

  try {
    const result = await apiUpload("/api/active-ninjas/import", file);
    if (result.preview) {
      openRosterReview(result);
      return;
    }
    showImportResult("activeImportBanner", result, "imported");
    if (result.successCount > 0) loadActiveNinjas();
  } catch (error) {
    showBanner("activeImportBanner", error.message, "error");
  } finally {
    e.target.value = "";
  }
});

// ---- Review window for a MyStudio "All classes schedule" export ----
// Nothing changes until the button is pressed, and only the ticked items are applied:
//  - new Ninjas (with their parent from the file, and the lead they came from),
//  - for Ninjas already here: classes added / gone, JR or AI marks, new parent details,
//  - Ninjas not in the file at all: their classes can be removed (their history is kept).

let rosterReview = { people: [], updates: [], missing: [] };

function familyText(f) {
  return f ? [f.name, f.email, f.phone].filter((v) => v && String(v).trim()).join(" · ") : "";
}

// A small ticked/unticked item inside a row: [x] content
function reviewToggle(content, checked) {
  const box = el("input", { type: "checkbox" });
  box.checked = checked;
  box.addEventListener("change", updateRosterReviewUI);
  const label = el("label", { class: "review-change" }, [box]);
  (Array.isArray(content) ? content : [content]).forEach((c) => label.appendChild(c));
  return { label, box };
}

function rosterReviewRow(person, checked) {
  const checkbox = el("input", { type: "checkbox" });
  checkbox.checked = checked;
  checkbox.addEventListener("change", updateRosterReviewUI);
  person.checkbox = checkbox;

  const name = el("span", { class: "person-name", text: person.name });
  if (person.lead) {
    name.appendChild(el("span", {
      class: "lead-badge",
      title: `Lead #${person.lead.entry_number} (${person.lead.ninja_name}) will show as enrolled`,
      text: `Lead #${person.lead.entry_number}`,
    }));
  }
  if (person.similar_to) {
    name.appendChild(el("span", { class: "muted review-similar", text: `already here as "${person.similar_to}"?` }));
  }
  if (familyText(person.family)) name.appendChild(el("span", { class: "review-family", text: "Parent: " + familyText(person.family) }));
  if (person.belt) name.appendChild(el("span", { class: "review-family", text: `${person.belt} belt (starting belt)` }));
  const sessions = el("span", { class: "sessions-cell" });
  person.sessions.forEach((r) => sessions.appendChild(sessionPill(r)));
  return el("label", { class: "review-row" }, [checkbox, name, sessions]);
}

// "Possibly already here": either a new Ninja, or the Ninja already on the roster (then their
// parent details are saved so the next import recognises them, plus any class changes).
function rosterSimilarRow(person) {
  const name = el("span", { class: "person-name", text: person.name });
  if (familyText(person.family)) name.appendChild(el("span", { class: "review-family", text: "Parent: " + familyText(person.family) }));
  const sessions = el("span", { class: "sessions-cell" });
  person.sessions.forEach((r) => sessions.appendChild(sessionPill(r)));
  name.appendChild(sessions);

  const choices = el("span", { class: "review-changes review-choices" });
  if (person.same_as) {
    const same = reviewToggle(el("span", { text: `Same Ninja as "${person.similar_to}": save the parent details and class changes` }), false);
    person.sameBox = same.box;
    choices.appendChild(same.label);
  }
  const asNew = reviewToggle(el("span", { text: "A different child: add as a new Ninja" }), false);
  person.checkbox = asNew.box;
  choices.appendChild(asNew.label);
  if (person.sameBox) {
    // One or the other.
    const same = person.sameBox;
    asNew.box.addEventListener("change", () => { if (asNew.box.checked) same.checked = false; updateRosterReviewUI(); });
    same.addEventListener("change", () => { if (same.checked) asNew.box.checked = false; updateRosterReviewUI(); });
  }
  return el("div", { class: "review-row" }, [name, choices]);
}

function rosterUpdateRow(update) {
  const name = el("span", { class: "person-name", text: update.name });
  if (update.file_name) name.appendChild(el("span", { class: "muted review-similar", text: `"${update.file_name}" in the file` }));

  const changes = el("span", { class: "review-changes" });
  if (update.file_name) {
    const t = reviewToggle(el("span", { text: `Rename to ${update.file_name}` }), false);
    update.renameBox = t.box;
    changes.appendChild(t.label);
  }
  update.add.forEach((s) => {
    const pill = sessionPill(s);
    pill.classList.add("adding");
    pill.prepend("+ ");
    pill.title = "New class in this file - add it";
    const t = reviewToggle(pill, true);
    s.box = t.box;
    changes.appendChild(t.label);
  });
  update.remove.forEach((s) => {
    const pill = sessionPill(s);
    pill.classList.add("removing");
    pill.title = "Not in this file - remove this class";
    const t = reviewToggle(pill, !!s.suggested);
    s.box = t.box;
    changes.appendChild(t.label);
  });
  update.marks.forEach((m) => {
    const what = [m.set_jr ? "JR" : "", m.set_ai ? "AI" : ""].filter(Boolean).join(" + ");
    const t = reviewToggle(el("span", { text: `Mark ${sessionLabel(m)} as ${what}` }), true);
    m.box = t.box;
    changes.appendChild(t.label);
  });
  if (update.family) {
    const t = reviewToggle(el("span", { text: "Parent: " + update.family.note }), true);
    update.familyBox = t.box;
    changes.appendChild(t.label);
  }
  const belt = beltChangeView(update.belt);
  if (belt) {
    if (belt.checkable) {
      const t = reviewToggle(el("span", { class: "belt-change " + update.belt.kind, text: belt.text }), belt.checked);
      update.beltBox = t.box;
      changes.appendChild(t.label);
    } else {
      changes.appendChild(el("span", { class: "muted", text: belt.text }));
    }
  }
  return el("div", { class: "review-row" }, [name, changes]);
}

// How a belt difference from the file is shown in the review window.
function beltChangeView(b) {
  if (!b) return null;
  if (b.kind === "up") {
    return { checkable: true, checked: true, text: `Belted up: ${b.from} \u2192 ${b.to} (+${b.levels} level${b.levels === 1 ? "" : "s"}, recorded on the Belt-ups list)` };
  }
  if (b.kind === "start") return { checkable: true, checked: true, text: `Belt: ${b.to} (first belt on file, no rewards)` };
  if (b.kind === "set") return { checkable: true, checked: true, text: `Belt: ${b.from} \u2192 ${b.to}` };
  if (b.kind === "lower") return { checkable: true, checked: false, text: `File says ${b.to}, here ${b.from} (lower - check before ticking)` };
  return { checkable: false, text: `Rank "${b.rank}" isn't a belt in Settings` };
}

function rosterMissingRow(person) {
  const checkbox = el("input", { type: "checkbox" });
  checkbox.addEventListener("change", updateRosterReviewUI);
  person.checkbox = checkbox;
  const sessions = el("span", { class: "sessions-cell" });
  person.sessions.forEach((r) => sessions.appendChild(sessionPill(r)));
  return el("label", { class: "review-row" }, [checkbox, el("span", { class: "person-name", text: person.name }), sessions]);
}

/** What would be sent if the button were pressed now. */
function rosterChoices() {
  const people = rosterReview.people.filter((p) => p.checkbox.checked)
    .map((p) => ({ name: p.name, family: p.family, lead: p.lead, belt: p.belt || "", sessions: p.sessions }));
  const familyOf = (f) => ({ name: f.name, email: f.email, phone: f.phone });
  const sessionOf = (s) => ({ day: s.day, time_slot: s.time_slot, is_ai: s.is_ai, is_jr: s.is_jr, notes: s.notes });
  const updates = rosterReview.updates.map((u) => ({
    uid: u.uid,
    rename: u.renameBox && u.renameBox.checked ? u.file_name : "",
    add: u.add.filter((s) => s.box.checked).map(sessionOf),
    remove: u.remove.filter((s) => s.box.checked).map((s) => ({ id: s.id })),
    marks: u.marks.filter((m) => m.box.checked).map((m) => ({ id: m.id, set_jr: m.set_jr, set_ai: m.set_ai })),
    family: u.family && u.familyBox.checked ? familyOf(u.family) : null,
    belt: u.beltBox && u.beltBox.checked ? { to: u.belt.to } : null,
  })).filter((u) => u.rename || u.add.length || u.remove.length || u.marks.length || u.family || u.belt);
  // "Same Ninja as ...": everything the file says about them (removals only where suggested).
  const linked = rosterReview.people.filter((p) => p.sameBox && p.sameBox.checked).map((p) => p.same_as);
  linked.forEach((u) => updates.push({
    uid: u.uid,
    add: u.add.map(sessionOf),
    remove: u.remove.filter((s) => s.suggested).map((s) => ({ id: s.id })),
    marks: u.marks.map((m) => ({ id: m.id, set_jr: m.set_jr, set_ai: m.set_ai })),
    family: u.family ? familyOf(u.family) : null,
    belt: u.belt && ["up", "start", "set"].includes(u.belt.kind) ? { to: u.belt.to } : null,
  }));
  const keep = new Set(linked.map((u) => u.uid)); // they are in the file after all
  const missing = rosterReview.missing.filter((m) => m.checkbox.checked && !keep.has(m.uid)).map((m) => m.uid);
  return { people, updates, missing };
}

const plural = (n, word, many) => `${n} ${n === 1 ? word : many || word + "s"}`;

function updateRosterReviewUI() {
  const { people, updates, missing } = rosterChoices();
  const fresh = rosterReview.people.filter((p) => !p.similar_to);
  document.getElementById("rosterSelectAll").checked = fresh.length > 0 && fresh.every((p) => p.checkbox.checked);
  const parts = [];
  if (people.length) parts.push(`add ${plural(people.length, "Ninja")}`);
  if (updates.length) parts.push(`update ${updates.length}`);
  if (missing.length) parts.push(`take ${missing.length} off`);
  const btn = document.getElementById("rosterSubmit");
  btn.textContent = parts.length ? parts.join(", ").replace(/^./, (c) => c.toUpperCase()) : "Apply";
  btn.disabled = !parts.length;
}

let rosterBanner = "activeImportBanner"; // where the result is shown (Active Ninjas or Belts tab)

function openRosterReview(result, bannerId) {
  rosterBanner = bannerId || "activeImportBanner";
  hideBanner("rosterError");
  rosterReview = { people: result.people || [], updates: result.updates || [], missing: result.missing || [] };
  const fresh = rosterReview.people.filter((p) => !p.similar_to);
  const similar = rosterReview.people.filter((p) => p.similar_to);
  const existing = result.alreadyThere || [];
  const inFile = rosterReview.people.length + rosterReview.updates.length + existing.length;

  const notFound = result.notFound || [];
  const notFoundText = notFound.length
    ? ` ${plural(notFound.length, "name")} in the file ${notFound.length === 1 ? "isn't a Ninja" : "aren't Ninjas"} here and ${notFound.length === 1 ? "was" : "were"} left out: ${notFound.join(", ")}.`
    : "";
  if (!rosterReview.people.length && !rosterReview.updates.length && !rosterReview.missing.length) {
    showBanner(
      rosterBanner,
      result.kind === "ranks"
        ? `No belt changes - all ${plural(existing.length, "Ninja")} found in that file already have that belt.${notFoundText}`
        : `Everything matches - all ${plural(existing.length, "Ninja")} in that file are already on the roster with the same classes and belts.`,
      "success"
    );
    return;
  }

  document.getElementById("rosterSummary").textContent = result.kind === "ranks"
    ? `${plural(inFile, "Ninja")} found in this belt list. Higher belts are recorded as belt-ups on the Belt-ups list (rewards follow).${notFoundText} Nothing changes until you press the button.`
    : `${plural(inFile, "Ninja")} in this file` + (result.days && result.days.length ? ` (${result.days.join(", ")})` : "") +
      ". Ninjas are matched by name and by parent email/phone. Nothing changes until you press the button.";

  const fill = (listId, sectionId, titleId, items, title, makeRow) => {
    const list = document.getElementById(listId);
    list.innerHTML = "";
    items.forEach((item) => list.appendChild(makeRow(item)));
    document.getElementById(titleId).textContent = `${title} (${items.length})`;
    document.getElementById(sectionId).style.display = items.length ? "block" : "none";
  };
  fill("rosterNewList", "rosterNewSection", "rosterNewTitle", fresh, "New Ninjas", (p) => rosterReviewRow(p, true));
  fill("rosterSimilarList", "rosterSimilarSection", "rosterSimilarTitle", similar, "Possibly already here", rosterSimilarRow);
  fill("rosterUpdateList", "rosterUpdateSection", "rosterUpdateTitle", rosterReview.updates,
    result.kind === "ranks" ? "Belt changes" : "Changes for Ninjas already here", rosterUpdateRow);
  fill("rosterMissingList", "rosterMissingSection", "rosterMissingTitle", rosterReview.missing, "Not in this file", rosterMissingRow);

  document.getElementById("rosterExistingTitle").textContent = `Already up to date (${existing.length})`;
  document.getElementById("rosterExistingList").textContent = existing.join(", ");
  document.getElementById("rosterExistingSection").style.display = existing.length ? "block" : "none";

  updateRosterReviewUI();
  document.getElementById("rosterModalOverlay").classList.add("open");
}

document.getElementById("rosterSelectAll").addEventListener("change", (e) => {
  rosterReview.people.filter((p) => !p.similar_to).forEach((p) => { p.checkbox.checked = e.target.checked; });
  updateRosterReviewUI();
});

document.getElementById("rosterCancel").addEventListener("click", () => {
  document.getElementById("rosterModalOverlay").classList.remove("open");
});

document.getElementById("rosterSubmit").addEventListener("click", async () => {
  const choices = rosterChoices();
  const btn = document.getElementById("rosterSubmit");
  btn.disabled = true;

  try {
    const r = await api("/api/active-ninjas/import/confirm", { method: "POST", body: JSON.stringify(choices) });
    const parts = [];
    if (r.addedNinjas) parts.push(`${plural(r.addedNinjas, "Ninja")} added (${plural(r.addedSessions, "class", "classes")})`);
    if (r.updatedNinjas) parts.push(`${plural(r.updatedNinjas, "Ninja")} updated`);
    if (r.addedClasses) parts.push(`${plural(r.addedClasses, "class", "classes")} added`);
    if (r.removedClasses) parts.push(`${plural(r.removedClasses, "class", "classes")} removed`);
    if (r.markedJr) parts.push(`${r.markedJr} marked JR`);
    if (r.markedAi) parts.push(`${r.markedAi} marked AI`);
    if (r.familiesUpdated) parts.push(`${plural(r.familiesUpdated, "parent")} updated`);
    if (r.removedNinjas) parts.push(`${plural(r.removedNinjas, "Ninja")} taken off the roster`);
    if (r.linkedLeads) parts.push(`${plural(r.linkedLeads, "lead")} marked enrolled`);
    if (r.renamed) parts.push(`${plural(r.renamed, "Ninja")} renamed`);
    const ups = r.beltUps || [];
    if (ups.length) parts.push(`${plural(ups.length, "Ninja")} belted up`);
    if (r.startingBelts) parts.push(`${plural(r.startingBelts, "starting belt")} recorded`);
    if (r.beltsCorrected) parts.push(`${plural(r.beltsCorrected, "belt")} corrected`);
    document.getElementById("rosterModalOverlay").classList.remove("open");
    showBannerWithDetails(rosterBanner, (parts.join(", ") || "Nothing changed") + ".", [
      { title: "Belted up (see the Belt-ups list and Rewards)", lines: ups },
      { title: "Left as they were", lines: r.skipped },
    ], parts.length ? "success" : "error");
    loadActiveNinjas();
    if (ups.length || r.startingBelts) loadBelts();
  } catch (error) {
    showBanner("rosterError", error.message, "error");
    btn.disabled = false;
  }
});

// ---- JR Ninjas: everyone in a JR class, and notes on what each one is working on ----
// Notes are shared with the whole team like everything else, newest first.

const JR_AUTHOR_KEY = "ninja.jrAuthor";
const jrKey = (name) => personKey(name).replace(/\s+/g, " ");
const jrExpanded = new Set(); // cards showing every note, not just the latest few

// The name put on new notes: whatever was typed last time on this computer, else the sign-in name.
function jrAuthor() {
  try {
    const saved = localStorage.getItem(JR_AUTHOR_KEY);
    if (saved) return saved;
  } catch (_) { /* storage blocked */ }
  return String(window.ninjaUserEmail || "").split("@")[0];
}

function rememberJrAuthor(name) {
  try { localStorage.setItem(JR_AUTHOR_KEY, name); } catch (_) { /* storage blocked */ }
}

// Saved in UTC ("2026-10-24 18:05:00"); shown as a local date.
function noteDate(createdAt) {
  const raw = String(createdAt || "");
  const d = new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(raw) ? raw : raw.replace(" ", "T") + "Z");
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function inlineError(node, message) {
  node.textContent = message;
  node.className = "banner show error";
}

function jrNoteItem(note, isLatest, refresh) {
  const item = el("div", { class: "jr-note" + (isLatest ? " latest" : "") });
  const text = el("div", { class: "jr-note-text", text: note.note });
  const meta = el("div", { class: "jr-note-meta" });
  meta.appendChild(el("span", {
    text: (isLatest ? "Latest · " : "") + [noteDate(note.created_at), note.author].filter(Boolean).join(" · "),
  }));
  const tools = el("span", { class: "jr-note-tools" });
  const editBtn = el("button", { class: "btn-icon btn-edit", type: "button", title: "Edit note", text: "✎" });
  const delBtn = el("button", { class: "btn-icon", type: "button", title: "Delete note", text: "✖" });
  tools.append(editBtn, delBtn);
  meta.appendChild(tools);
  item.append(text, meta);

  editBtn.addEventListener("click", () => {
    const box = el("textarea", { class: "jr-draft", rows: "3", "data-draft": "1" });
    box.value = note.note;
    const save = el("button", { class: "btn-primary", type: "button", text: "Save" });
    const cancel = el("button", { class: "btn-secondary", type: "button", text: "Cancel" });
    const error = el("div", { class: "banner" });
    const editor = el("div", { class: "jr-edit" }, [box, el("div", { class: "jr-add-row" }, [cancel, save]), error]);
    item.replaceChild(editor, text);
    tools.style.display = "none";
    box.focus();
    cancel.addEventListener("click", () => {
      item.replaceChild(text, editor);
      tools.style.display = "";
    });
    save.addEventListener("click", async () => {
      if (!box.value.trim()) { inlineError(error, "A note can't be empty. Delete it instead."); return; }
      save.disabled = true;
      try {
        await api(`/api/jr-notes/${note.id}`, { method: "PUT", body: JSON.stringify({ note: box.value }) });
        box.value = "";
        await refresh();
      } catch (e) {
        inlineError(error, e.message);
        save.disabled = false;
      }
    });
  });

  delBtn.addEventListener("click", async () => {
    const ok = await confirmDialog("Delete Note", `Delete this note?\n\n"${note.note}"`);
    if (!ok) return;
    await api(`/api/jr-notes/${note.id}`, { method: "DELETE" });
    await refresh();
  });
  return item;
}

// ---- JR skills checklist (rules in js/lib/jr_skills.js; skills listed in Settings)

const JR_STATUS_LABELS = { working: "Working on", needs_work: "Needs work", done: "Got it" };
const jrSkillsOpen = new Set(); // cards whose checklist is open

// "Needs work: ... / Working on: ... / Got it: ..." as coloured chips.
function jrSkillSummary(summary, emptyText) {
  const box = el("div", { class: "jr-skill-summary" });
  ["needs_work", "working", "done"].forEach((status) => {
    if (!summary[status].length) return;
    const line = el("div", { class: "jr-skill-line" }, [el("span", { class: "jr-skill-head", text: JR_STATUS_LABELS[status] + ":" })]);
    summary[status].forEach((s) => line.appendChild(el("span", { class: "jr-chip " + status, text: s })));
    box.appendChild(line);
  });
  if (!box.childNodes.length) box.appendChild(el("div", { class: "muted", text: emptyText || "Nothing on the skills checklist yet." }));
  return box;
}

// Every skill with a drop-down: the notes' suggestion, or what a sensei set (which always wins).
function jrChecklist(person, refresh) {
  const key = jrKey(person.name);
  const fromNotes = person.skills.filter((s) => s.source === "notes").length;
  const bySensei = person.skills.filter((s) => s.source === "sensei").length;
  const box = el("details", { class: "jr-checklist" });
  if (jrSkillsOpen.has(key)) box.setAttribute("open", "");
  box.addEventListener("toggle", () => { if (box.open) jrSkillsOpen.add(key); else jrSkillsOpen.delete(key); });
  box.appendChild(el("summary", { text: `Skills checklist`, title: `${fromNotes} suggested from notes, ${bySensei} set by a sensei` }));
  const error = el("div", { class: "banner" });
  let area = null;
  person.skills.forEach((item) => {
    if (item.area !== area) {
      area = item.area;
      box.appendChild(el("div", { class: "jr-skill-area", text: area }));
    }
    const select = el("select", { title: "Pick a status, or leave it on the notes' suggestion" });
    const auto = item.from_notes;
    select.appendChild(el("option", { value: "", text: auto ? `From notes: ${JR_STATUS_LABELS[auto.status]}` : "—" }));
    Object.entries(JR_STATUS_LABELS).forEach(([value, text]) => select.appendChild(el("option", { value, text })));
    select.value = item.source === "sensei" ? item.status : "";
    select.className = "jr-skill-select " + (item.status || "none");
    select.addEventListener("change", async () => {
      select.disabled = true;
      try {
        await api("/api/jr-skills", { method: "PUT", body: JSON.stringify({ name: person.name, uid: person.uid, skill: item.skill, status: select.value, author: jrAuthor() }) });
        await refresh();
      } catch (e) {
        inlineError(error, e.message);
        select.disabled = false;
      }
    });
    const why = item.source === "sensei"
      ? `Set by ${item.set_by || "a sensei"}${item.set_on ? " on " + noteDate(item.set_on) : ""}` +
        (auto ? ` · notes say ${JR_STATUS_LABELS[auto.status]}` : "")
      : auto ? `${noteDate(auto.date)}: "${auto.phrase}"` : "";
    box.appendChild(el("div", { class: "jr-skill-row" }, [
      el("div", {}, [el("div", { class: "jr-skill-name", text: item.skill }), why ? el("div", { class: "jr-skill-why", text: why }) : el("span")]),
      select,
    ]));
  });
  box.appendChild(error);
  box.appendChild(el("div", { class: "muted jr-skill-help", text:
    "Suggestions come from the notes (the newest note that mentions a skill). Pick a status to set it yourself; " +
    "pick the first option to go back to the notes. Change the list of skills in Settings." }));
  return box;
}

// ---- Priority: who needs a sensei's attention first ----
// "attention" = at least one skill marked Needs work; "stale" = no note yet, or none in JR_STALE_DAYS;
// "ok" = everything else. The JR view lists them in that order.

const JR_STALE_DAYS = 21;
const JR_PRIORITY = {
  attention: { rank: 0, label: "Needs work", chip: "Needs work" },
  stale: { rank: 1, label: "Needs a note", chip: "Needs a note" },
  ok: { rank: 2, label: "On track", chip: "On track" },
};
let jrFilter = "all"; // "all" | a JR_PRIORITY key
const jrAdding = new Set(); // cards with the "add note" box open

function daysSinceNote(createdAt) {
  const raw = String(createdAt || "");
  if (!raw) return null;
  const d = new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(raw) ? raw : raw.replace(" ", "T") + "Z");
  return isNaN(d) ? null : Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

function jrPriority(person) {
  const needs = person.summary ? person.summary.needs_work.length : 0;
  const days = person.notes.length ? daysSinceNote(person.notes[0].created_at) : null;
  const level = needs ? "attention" : (days === null || days >= JR_STALE_DAYS) ? "stale" : "ok";
  let reason;
  if (level === "attention") reason = `Needs work on ${needs} skill${needs === 1 ? "" : "s"}`;
  else if (days === null) reason = "No notes yet";
  else if (level === "stale") reason = `No note for ${days} days`;
  else reason = "On track";
  return { level, needs, days, reason };
}

const jrPriorityOrder = (a, b) =>
  JR_PRIORITY[a.priority.level].rank - JR_PRIORITY[b.priority.level].rank ||
  b.priority.needs - a.priority.needs ||
  (b.priority.days === null ? Infinity : b.priority.days) - (a.priority.days === null ? Infinity : a.priority.days) ||
  a.name.localeCompare(b.name);

const lastNoteText = (days) => days === null ? "never" : days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;

// One JR Ninja. Top to bottom, most important first: why they are (or aren't) a priority,
// what to focus on next, the latest note, then the add-note box, older notes and the full checklist.
function jrCard(person, refresh, opts = {}) {
  const key = jrKey(person.name);
  const priority = person.priority || jrPriority(person);
  const card = el("div", { class: `jr-card prio-${priority.level}`, "data-person": key });

  const head = el("div", { class: "jr-card-head" });
  head.appendChild(el("div", { class: "jr-card-title" }, [
    ninjaLink(person.name, person.uid),
    el("span", { class: "jr-belt" + (person.belt ? "" : " belt-unknown"), text: person.belt ? `${person.belt} belt` : "No belt yet" }),
  ]));
  head.appendChild(el("span", { class: `jr-prio-badge ${priority.level}`, text: priority.reason }));
  card.appendChild(head);
  const sessions = el("div", { class: "sessions-cell jr-sessions" });
  sortSessions(person.sessions).forEach((r) => sessions.appendChild(sessionPill(r)));
  card.appendChild(sessions);

  // Focus: Needs work first (the priority), then Working on; Got it is just a count with the names on hover.
  if (person.summary) {
    const s = person.summary;
    const focus = el("div", { class: "jr-focus" });
    const row = (status, label, items) => {
      if (!items.length) return;
      const line = el("div", { class: `jr-focus-row ${status}` }, [el("span", { class: "jr-focus-label", text: label })]);
      const chips = el("div", { class: "jr-focus-chips" });
      items.forEach((name) => chips.appendChild(el("span", { class: "jr-chip " + status, text: name })));
      line.appendChild(chips);
      focus.appendChild(line);
    };
    row("needs_work", "Needs work", s.needs_work);
    row("working", "Working on", s.working);
    if (s.done.length) {
      focus.appendChild(el("div", { class: "jr-focus-done", title: s.done.join(", "),
        text: `✓ Got it: ${s.done.length} skill${s.done.length === 1 ? "" : "s"}` }));
    }
    if (!focus.childNodes.length) {
      focus.appendChild(el("div", { class: "muted", text: "No skills yet: add a note, or set them in the checklist below." }));
    }
    card.appendChild(focus);
  }

  // Latest note, then the rest behind a button.
  const list = el("div", { class: "jr-notes" });
  if (!person.notes.length) list.appendChild(el("div", { class: "muted jr-no-notes", text: "No notes yet." }));
  const showAll = jrExpanded.has(key);
  (showAll ? person.notes : person.notes.slice(0, 1)).forEach((n, i) => list.appendChild(jrNoteItem(n, i === 0, refresh)));
  if (person.notes.length > 1) {
    const more = el("button", {
      class: "link-btn", type: "button",
      text: showAll ? "Show only the latest note" : `Show ${person.notes.length - 1} older note${person.notes.length === 2 ? "" : "s"}`,
    });
    more.addEventListener("click", async () => {
      if (jrExpanded.has(key)) jrExpanded.delete(key); else jrExpanded.add(key);
      await refresh();
    });
    list.appendChild(more);
  }
  card.appendChild(list);

  // Add a note: one button until it's needed (always open in the JR notes window).
  const draft = el("textarea", {
    class: "jr-draft jr-new", rows: "3", "data-draft": "1",
    placeholder: "What did they work on today? What's next? (Ctrl+Enter to save)",
  });
  const author = el("input", { type: "text", class: "jr-author", placeholder: "Your name", title: "Who wrote this note" });
  author.value = jrAuthor();
  const addBtn = el("button", { class: "btn-primary", type: "button", text: "Save note" });
  const cancelBtn = el("button", { class: "btn-secondary", type: "button", text: "Cancel" });
  const error = el("div", { class: "banner" });
  const addBox = el("div", { class: "jr-add" }, [draft, el("div", { class: "jr-add-row" }, [author, cancelBtn, addBtn]), error]);
  const openBtn = el("button", { class: "btn-secondary jr-open-add", type: "button", text: "+ Add note" });
  const setOpen = (open) => {
    addBox.style.display = open ? "" : "none";
    openBtn.style.display = open ? "none" : "";
    cancelBtn.style.display = opts.alwaysOpen ? "none" : "";
    if (open) jrAdding.add(key); else jrAdding.delete(key);
  };
  setOpen(opts.alwaysOpen || jrAdding.has(key));
  openBtn.addEventListener("click", () => { setOpen(true); draft.focus(); });
  cancelBtn.addEventListener("click", () => { draft.value = ""; setOpen(false); });
  addBtn.addEventListener("click", async () => {
    const note = draft.value.trim();
    if (!note) { draft.focus(); return; }
    addBtn.disabled = true;
    try {
      await api("/api/jr-notes", { method: "POST", body: JSON.stringify({ name: person.name, note, author: author.value.trim() }) });
      rememberJrAuthor(author.value.trim());
      draft.value = "";
      if (!opts.alwaysOpen) jrAdding.delete(key);
      await refresh();
    } catch (e) {
      inlineError(error, e.message);
      addBtn.disabled = false;
    }
  });
  draft.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) addBtn.click();
  });

  const foot = el("div", { class: "jr-card-foot" });
  if (person.skills) foot.appendChild(jrChecklist(person, refresh));
  foot.appendChild(openBtn);
  card.appendChild(addBox);
  card.appendChild(foot);
  return card;
}

// Unsent "add note" text survives a redraw (and keeps its box open).
function keepJrDrafts(container, draw) {
  const drafts = {};
  container.querySelectorAll(".jr-card").forEach((card) => {
    const box = card.querySelector("textarea.jr-new");
    if (box && box.value) drafts[card.dataset.person] = box.value;
  });
  Object.keys(drafts).forEach((k) => jrAdding.add(k));
  draw();
  container.querySelectorAll(".jr-card").forEach((card) => {
    const box = card.querySelector("textarea.jr-new");
    if (box && drafts[card.dataset.person]) box.value = drafts[card.dataset.person];
  });
}

async function loadJrView() {
  const container = document.getElementById("activeJr");
  let people;
  try {
    people = await api("/api/jr-ninjas");
  } catch (error) {
    container.textContent = error.message;
    return;
  }
  people.forEach((p) => { p.priority = jrPriority(p); });
  people.sort(jrPriorityOrder);
  const search = jrKey(document.getElementById("activeSearch").value);
  const matching = !search || search === "jr" ? people : people.filter((p) =>
    jrKey(p.name).includes(search) || p.sessions.some((s) => jrKey(`${s.day} ${s.time_slot}`).includes(search)));
  const counts = { all: matching.length };
  Object.keys(JR_PRIORITY).forEach((level) => { counts[level] = matching.filter((p) => p.priority.level === level).length; });
  if (jrFilter !== "all" && !counts[jrFilter]) jrFilter = "all";
  const shown = jrFilter === "all" ? matching : matching.filter((p) => p.priority.level === jrFilter);

  keepJrDrafts(container, () => {
    container.innerHTML = "";
    if (!people.length) {
      container.appendChild(el("div", {
        class: "jr-summary muted",
        text: "No JR Ninjas yet. Importing the MyStudio schedule marks JR classes automatically, " +
          "or tick \"JR?\" on a Ninja's class with the ✎ button.",
      }));
      return;
    }

    // Filter chips double as the overview: how many need what.
    const bar = el("div", { class: "jr-toolbar" });
    const chip = (level, label) => {
      const b = el("button", {
        type: "button", class: `jr-filter ${level}` + (jrFilter === level ? " active" : ""),
        title: level === "stale" ? `No note yet, or none in the last ${JR_STALE_DAYS} days` : "",
      }, [el("span", { text: label }), el("b", { text: String(counts[level]) })]);
      b.addEventListener("click", () => { jrFilter = level; loadJrView(); });
      bar.appendChild(b);
    };
    chip("all", "All JR Ninjas");
    Object.entries(JR_PRIORITY).forEach(([level, p]) => chip(level, p.chip));
    container.appendChild(bar);
    container.appendChild(el("div", {
      class: "jr-summary muted",
      text: "Most urgent first: Needs work, then Ninjas with no recent note, then everyone on track." +
        (search && search !== "jr" ? ` ${matching.length} of ${people.length} match the search.` : "") +
        " Notes are shared with every sensei.",
    }));

    if (!shown.length) {
      container.appendChild(el("div", { class: "jr-summary muted", text: "No JR Ninjas match." }));
      return;
    }
    let level = null;
    shown.forEach((p) => {
      if (jrFilter === "all" && p.priority.level !== level) {
        level = p.priority.level;
        container.appendChild(el("h3", { class: `jr-group-head ${level}`, text: `${JR_PRIORITY[level].label} (${counts[level]})` }));
      }
      container.appendChild(jrCard(p, loadJrView));
    });
  });
}

document.getElementById("viewJrBtn").addEventListener("click", () => setActiveView("jr"));

// The 📝 button on a JR Ninja in the schedule.
async function openJrNotes(name) {
  const body = document.getElementById("jrModalBody");
  const draw = async () => {
    const people = await api("/api/jr-ninjas");
    const person = people.find((p) => jrKey(p.name) === jrKey(name)) || { name, belt: "", sessions: [], notes: [] };
    keepJrDrafts(body, () => {
      body.innerHTML = "";
      body.appendChild(jrCard(person, draw, { alwaysOpen: true }));
    });
  };
  await draw();
  document.getElementById("jrModalOverlay").classList.add("open");
  const box = body.querySelector("textarea.jr-new");
  if (box) box.focus();
}

document.getElementById("jrModalClose").addEventListener("click", () => {
  document.getElementById("jrModalOverlay").classList.remove("open");
  if (activeView === "jr") loadJrView();
});

// ---- Add / Edit modal: one Ninja, any number of sessions ----

let sessionRows = [];   // [{id?, day, time_slot, is_ai}] being edited
let editingOriginalName = null;
let editingUid = null;  // the Ninja record being edited (null when adding)

function fillFamilyFields(row) {
  document.getElementById("af_parent_name").value = (row && row.family_name) || "";
  document.getElementById("af_parent_email").value = (row && row.family_email) || "";
  document.getElementById("af_parent_phone").value = (row && row.family_phone) || "";
  document.getElementById("af_family_note").textContent = "";
}

// "Also the parent of Emma Park · came from lead #12" under the parent fields.
async function showFamilyNote(uid) {
  const note = document.getElementById("af_family_note");
  if (!uid) return;
  try {
    const ninja = await api("/api/ninjas/" + encodeURIComponent(uid));
    if (editingUid !== uid) return; // a different Ninja was opened meanwhile
    const parts = [];
    if (ninja.siblings && ninja.siblings.length) {
      parts.push("Also the parent of " + ninja.siblings.map((x) => x.name).join(", ") + " (changes apply to them too)");
    }
    (ninja.leads || []).forEach((l) => parts.push(`came from lead #${l.entry_number}`));
    note.textContent = parts.join(" · ");
  } catch (error) {
    note.textContent = ""; // older data or a Ninja removed meanwhile: the fields still work
  }
}

function dayIndex(day) {
  const i = (settings.schedule_days || []).indexOf(day);
  return i === -1 ? 99 : i;
}

function renderSessionRows() {
  const container = document.getElementById("af_sessions");
  container.innerHTML = "";

  sessionRows.forEach((sess, index) => {
    const line = el("div", { class: "session-row" });

    const daySelect = el("select");
    populateActiveDayDropdown(daySelect, sess.day);
    daySelect.addEventListener("change", () => { sess.day = daySelect.value; });

    const timeInput = el("input", { type: "text", placeholder: "4 PM - 5 PM", list: "timeSlotOptions" });
    timeInput.value = sess.time_slot || "";
    timeInput.addEventListener("input", () => { sess.time_slot = timeInput.value; });

    const aiBox = el("input", { type: "checkbox", title: "Artificial Intelligence class" });
    aiBox.checked = !!sess.is_ai;
    aiBox.addEventListener("change", () => { sess.is_ai = aiBox.checked; });
    const aiCell = el("label", { class: "session-ai" }, [aiBox]);

    const jrBox = el("input", { type: "checkbox", title: "JR (ScratchJr) class" });
    jrBox.checked = !!sess.is_jr;
    jrBox.addEventListener("change", () => { sess.is_jr = jrBox.checked; });
    const jrCell = el("label", { class: "session-ai" }, [jrBox]);

    const removeBtn = el("button", { class: "btn-icon", type: "button", title: "Remove this session", text: "\u2716" });
    removeBtn.addEventListener("click", () => {
      sessionRows.splice(index, 1);
      if (sessionRows.length === 0) sessionRows.push({ day: "", time_slot: "", is_ai: false, is_jr: false });
      renderSessionRows();
    });

    [daySelect, timeInput, aiCell, jrCell, removeBtn].forEach((node) => line.appendChild(node));
    container.appendChild(line);
  });
}

function refreshTimeSlotSuggestions() {
  const list = document.getElementById("timeSlotOptions");
  list.innerHTML = "";
  const slots = [...new Set(activeRowsCache.map((r) => (r.time_slot || "").trim()).filter(Boolean))]
    .sort((a, b) => timeSlotSortKey(a) - timeSlotSortKey(b) || a.localeCompare(b));
  slots.forEach((slot) => list.appendChild(el("option", { value: slot })));
}

// Belt dropdown: the Settings belt colours, plus the Ninja's current belt if it isn't one of them.
let editingBelt = ""; // the belt the Ninja had when the edit window opened

// Belt position in the Settings order (-1 = blank or not a Settings belt).
function beltRank(belt) {
  const order = (settings.belt_options || []).map((b) => String(b).trim().toLowerCase().replace(/\s+belts?$/, ""));
  return order.indexOf(String(belt || "").trim().toLowerCase().replace(/\s+belts?$/, ""));
}

// Raising a belt that was already set: offer to record it as a belt-up (ticked).
function updateBeltUpOption() {
  const chosen = document.getElementById("af_belt").value;
  const higher = !!editingBelt && beltRank(chosen) > beltRank(editingBelt) && beltRank(editingBelt) >= 0;
  document.getElementById("af_belt_up_row").style.display = higher ? "flex" : "none";
  if (higher) {
    document.getElementById("af_belt_up_text").textContent =
      `Record ${editingBelt} \u2192 ${chosen} as a belt-up on the Belt-ups list (Rewards will count it). Untick to only fix a mistake.`;
  }
}
document.getElementById("af_belt").addEventListener("change", updateBeltUpOption);

function fillBeltSelect(current) {
  editingBelt = current || "";
  document.getElementById("af_belt_up").checked = true;
  const select = document.getElementById("af_belt");
  select.innerHTML = "";
  const belts = (settings.belt_options || []).map((b) => formatBeltName(String(b).trim())).filter(Boolean);
  if (current && !belts.some((b) => b.toLowerCase() === current.toLowerCase())) belts.push(current);
  select.appendChild(el("option", { value: "", text: "Not set (use the Belt-ups list)" }));
  belts.forEach((b) => select.appendChild(el("option", { value: b, text: b })));
  select.value = belts.find((b) => b.toLowerCase() === current.toLowerCase()) || "";
  updateBeltUpOption();
}

async function openActiveModal(row) {
  hideBanner("activeFormError");
  refreshTimeSlotSuggestions();

  if (row) {
    editingOriginalName = row.name;
    editingUid = row.ninja_uid || null;
    document.getElementById("activeModalTitle").textContent = "Edit Ninja";
    document.getElementById("af_name").value = row.name;

    // Load every session this Ninja has (not just the row that was clicked).
    let all = [];
    try {
      all = editingUid
        ? await api("/api/active-ninjas/person?uid=" + encodeURIComponent(editingUid))
        : await api("/api/active-ninjas/person?name=" + encodeURIComponent(row.name));
    } catch (error) {
      all = [row];
    }
    if (all.length === 0) all = [row];
    fillBeltSelect((all.find((r) => r.belt) || {}).belt || "");
    fillFamilyFields(all[0]);
    showFamilyNote(editingUid);

    sessionRows = all
      .map((r) => ({ id: r.id, day: r.day || "", time_slot: r.time_slot || "", is_ai: !!r.is_ai, is_jr: !!r.is_jr }))
      .sort((a, b) => dayIndex(a.day) - dayIndex(b.day) ||
                      timeSlotSortKey(a.time_slot) - timeSlotSortKey(b.time_slot));
  } else {
    editingOriginalName = null;
    editingUid = null;
    document.getElementById("activeModalTitle").textContent = "Add Ninja";
    document.getElementById("af_name").value = "";
    fillBeltSelect("");
    fillFamilyFields(null);
    sessionRows = [{ day: "", time_slot: "", is_ai: false, is_jr: false }];
  }

  renderSessionRows();
  document.getElementById("activeModalOverlay").classList.add("open");
}

document.getElementById("addActiveBtn").addEventListener("click", () => openActiveModal(null));

document.getElementById("addSessionBtn").addEventListener("click", () => {
  // Start the new row from the previous one: same day is the common case
  // (regular hour then AI hour), and it saves retyping.
  const last = sessionRows[sessionRows.length - 1] || { day: "", time_slot: "" };
  sessionRows.push({ day: last.day, time_slot: "", is_ai: false, is_jr: !!last.is_jr });
  renderSessionRows();
  const inputs = document.querySelectorAll("#af_sessions .session-row input[type=text]");
  if (inputs.length) inputs[inputs.length - 1].focus();
});

document.getElementById("activeModalCancel").addEventListener("click", () => {
  document.getElementById("activeModalOverlay").classList.remove("open");
});

document.getElementById("activeModalSubmit").addEventListener("click", async () => {
  const payload = {
    uid: editingUid,
    original_name: editingOriginalName,
    name: document.getElementById("af_name").value,
    belt: document.getElementById("af_belt").value,
    belt_up: document.getElementById("af_belt_up_row").style.display === "none" || document.getElementById("af_belt_up").checked,
    family: {
      name: document.getElementById("af_parent_name").value,
      email: document.getElementById("af_parent_email").value,
      phone: document.getElementById("af_parent_phone").value,
    },
    sessions: sessionRows
      .filter((s) => s.id || s.day || (s.time_slot || "").trim() || s.is_ai || s.is_jr)
      .map((s) => ({ id: s.id, day: s.day, time_slot: s.time_slot, is_ai: s.is_ai, is_jr: s.is_jr })),
  };

  const btn = document.getElementById("activeModalSubmit");
  btn.disabled = true;

  try {
    await api("/api/active-ninjas/person", { method: "POST", body: JSON.stringify(payload) });
    document.getElementById("activeModalOverlay").classList.remove("open");
    loadActiveNinjas();
  } catch (error) {
    showBanner("activeFormError", error.message, "error");
  } finally {
    btn.disabled = false;
  }
});

// ---- Bulk Add modal ----

document.getElementById("bulkAddActiveBtn").addEventListener("click", () => {
  document.getElementById("bulkActiveText").value = "";
  hideBanner("bulkActiveBanner");
  document.getElementById("bulkActiveModalOverlay").classList.add("open");
});

document.getElementById("bulkActiveCancel").addEventListener("click", () => {
  document.getElementById("bulkActiveModalOverlay").classList.remove("open");
});

document.getElementById("bulkActiveSubmit").addEventListener("click", async () => {
  const text = document.getElementById("bulkActiveText").value;
  const btn = document.getElementById("bulkActiveSubmit");
  btn.disabled = true;

  try {
    const result = await api("/api/active-ninjas/bulk", { method: "POST", body: JSON.stringify({ text }) });
    showImportResult("bulkActiveBanner", result, "added");
    if (result.successCount > 0) {
      document.getElementById("bulkActiveText").value = "";
      loadActiveNinjas();
    }
  } catch (error) {
    showBanner("bulkActiveBanner", error.message, "error");
  } finally {
    btn.disabled = false;
  }
});

// ================================================================
// LEADS
// ================================================================

// Same normalizing as js/api/leads.js, so "(905) 555-1234" matches "905-555-1234".
function leadPhoneKey(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length >= 7 ? digits : "";
}

function leadEmailKey(value) {
  const email = String(value || "").trim().toLowerCase();
  return email.includes("@") ? email : "";
}

const LEAD_GROUP_TITLES = {
  upcoming: "Upcoming GBS - soonest first",
  past: "Past GBS - most recent first",
  none: "No GBS date",
};

// ---- Upcoming GBS as cards: one per lead, grouped by day, soonest first ----
// The most useful things first: when (day + time), who (child, age, GBS type), how to reach the
// parent (tap to call / email), then what staff should know (coding experience, comments).

// "2026-11-21" -> {when: "Tomorrow", date: "Saturday, Nov 21", days: 1}
function gbsDayLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const day = new Date(y, m - 1, d);
  const today = new Date();
  const days = Math.round((day - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  const when = days <= 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`;
  return { when, days, date: day.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) };
}

function leadContact(icon, value, href, dup, dupWhat) {
  const line = el("div", { class: "gbs-contact" + (dup ? " dup" : "") }, [el("span", { class: "gbs-contact-icon", text: icon })]);
  line.appendChild(el("a", { href, text: value }));
  if (dup) line.appendChild(el("span", { class: "dup-badge", title: `Another lead has this same ${dupWhat}`, text: "Duplicate" }));
  return line;
}

const NO_CHILD_NAME = "(child's name not found)"; // what supabase/schema.sql add_lead_inquiry() saves

// inquiry: a lead that arrived from a CRM email and nobody has checked yet.
function upcomingLeadCard(row, flags, inquiry = false) {
  const card = el("div", { class: "gbs-card" + (inquiry ? " inquiry" : "") });

  // When (for an inquiry: that it is new, and when it came in)
  const head = el("div", { class: "gbs-card-head" });
  if (inquiry) {
    head.appendChild(el("div", { class: "gbs-inquiry-label" }, [
      el("span", { class: "gbs-inquiry-tag", text: "✉ New inquiry" }),
      el("span", { class: "muted", text: row.lead_date ? `received ${row.lead_date}` : "" }),
    ]));
  } else {
    head.appendChild(el("div", { class: "gbs-time" + (row.gbs_time ? "" : " missing"), text: row.gbs_time || "Time not set" }));
  }
  const tools = el("div", { class: "gbs-card-tools" });
  const box = el("input", { type: "checkbox", title: "Select (for totem tags or delete)" });
  box.checked = leadsSelected.has(row.id);
  box.addEventListener("change", () => {
    if (box.checked) leadsSelected.add(row.id); else leadsSelected.delete(row.id);
    updateLeadsSelectionUI();
  });
  const editBtn = el("button", { class: "btn-icon btn-edit", type: "button", title: "Edit this lead", text: "\u270e" });
  editBtn.addEventListener("click", () => openLeadModal(row));
  tools.append(box, editBtn);
  head.appendChild(tools);
  card.appendChild(head);

  // Who
  const childName = row.ninja_name && row.ninja_name !== NO_CHILD_NAME ? row.ninja_name : "";
  const who = el("div", { class: "gbs-who" }, [el("span", { class: "gbs-name" + (childName ? "" : " missing"), text: childName || "Child's name not found" })]);
  if (row.age) who.appendChild(el("span", { class: "gbs-age", text: `Age ${row.age}` }));
  if (row.gbs_type) who.appendChild(el("span", { class: "gbs-type", text: row.gbs_type }));
  if (row.enrolled) {
    const badge = el("button", { class: "enrolled-badge", type: "button", title: "This child is now a Ninja - open their page", text: "Enrolled" });
    badge.addEventListener("click", () => openNinjaProfile({ uid: row.ninja_uid }));
    who.appendChild(badge);
  }
  card.appendChild(who);
  if (inquiry && (row.gbs_date || row.gbs_time)) {
    card.appendChild(el("div", { class: "gbs-asked", text: `Asked for: ${[row.gbs_date, row.gbs_time].filter(Boolean).join(" at ")}` }));
  }

  // Parent + how to reach them
  const contact = el("div", { class: "gbs-parent" });
  contact.appendChild(el("div", { class: "gbs-parent-name", text: row.parent_name ? `Parent: ${row.parent_name}` : "Parent: not given" }));
  if (row.phone_number) {
    contact.appendChild(leadContact("\u260e", row.phone_number, "tel:" + String(row.phone_number).replace(/[^\d+]/g, ""), flags.isDupPhone(row), "phone number"));
  }
  if (row.email) contact.appendChild(leadContact("\u2709", row.email, "mailto:" + row.email, flags.isDupEmail(row), "email"));
  card.appendChild(contact);

  // What staff should know
  const facts = [["Coding experience", row.coding_experience], ["Comments", row.comments]].filter(([, v]) => String(v || "").trim());
  if (facts.length) {
    const dl = el("div", { class: "gbs-facts" });
    facts.forEach(([label, value]) => dl.append(el("div", { class: "gbs-fact-label", text: label }), el("div", { class: "gbs-fact", text: value })));
    card.appendChild(dl);
  }

  // Things to sort out before they arrive
  // (for an inquiry: what still has to be filled in)
  const warnings = [];
  if (inquiry) {
    if (!childName) warnings.push("Child's name");
    if (!row.age) warnings.push("Age");
    if (!row.phone_number && !row.email) warnings.push("Phone or email");
    if (!row.gbs_date) warnings.push("GBS date");
    if (!row.gbs_time) warnings.push("GBS time");
  } else {
    if (!row.gbs_time) warnings.push("No GBS time");
    if (!row.phone_number && !row.email) warnings.push("No phone or email");
    if (!row.staff_name) warnings.push("No staff assigned");
  }
  if (warnings.length) {
    card.appendChild(el("div", { class: "gbs-warnings" }, [
      ...(inquiry ? [el("b", { class: "gbs-warnings-head", text: "Still needed:" })] : []),
      ...warnings.map((w) => el("span", { text: (inquiry ? "" : "\u26a0 ") + w })),
    ]));
  }

  if (inquiry) {
    if (row.inquiry_email) {
      card.appendChild(el("details", { class: "gbs-original" }, [
        el("summary", { text: "Original email" }),
        el("div", { class: "gbs-original-text", text: row.inquiry_email }),
      ]));
    }
    const actions = el("div", { class: "gbs-inquiry-actions" });
    const fill = el("button", { class: "btn-secondary btn-small", type: "button", text: "\u270e Fill in details" });
    fill.addEventListener("click", () => openLeadModal(row));
    const done = el("button", { class: "btn-primary btn-small", type: "button", title: "Checked and filled in: move it to the normal leads", text: "\u2713 Mark complete" });
    done.addEventListener("click", async () => {
      if (warnings.length && !(await confirmDialog("Mark Complete",
        `Still missing for ${childName || "this lead"}: ${warnings.join(", ")}.\n\nMark it complete anyway?`))) return;
      done.disabled = true;
      try {
        await api(`/api/leads/${row.id}/inquiry-done`, { method: "POST" });
        loadLeads();
      } catch (error) {
        showBanner("leadsImportBanner", error.message, "error");
        done.disabled = false;
      }
    });
    actions.append(fill, done);
    card.appendChild(actions);
  }

  const foot = el("div", { class: "gbs-card-foot" });
  if (row.staff_name) foot.appendChild(el("span", { class: "gbs-chip", text: `Staff: ${row.staff_name}` }));
  if (row.post_gbs_follow_up) foot.appendChild(el("span", { class: "gbs-chip", text: `Follow-up: ${row.post_gbs_follow_up}` }));
  if (row.gbs_completed) foot.appendChild(el("span", { class: "gbs-chip", text: `Completed: ${row.gbs_completed}` }));
  foot.appendChild(el("span", { class: "gbs-entry", text: `Lead #${row.entry_number}` + (row.lead_date ? ` · added ${row.lead_date}` : "") }));
  card.appendChild(foot);
  return card;
}

function renderUpcomingLeads(rows, flags, emptyText) {
  const box = document.getElementById("upcomingLeads");
  box.innerHTML = "";
  if (!rows.length) {
    box.appendChild(el("div", { class: "empty-state", text: emptyText }));
    return;
  }
  const week = rows.filter((r) => gbsDayLabel(r.gbs_day).days < 7).length;
  box.appendChild(el("div", { class: "gbs-upcoming-head" }, [
    el("h3", { text: `Upcoming GBS (${rows.length})` }),
    el("span", { class: "muted", text: `${week} in the next 7 days · soonest first · tap a phone number or email to contact the parent` }),
  ]));
  let day = null, group = null;
  rows.forEach((row) => {
    if (row.gbs_day !== day) {
      day = row.gbs_day;
      const label = gbsDayLabel(day);
      const count = rows.filter((r) => r.gbs_day === day).length;
      box.appendChild(el("div", { class: "gbs-day-head" + (label.days <= 1 ? " soon" : "") }, [
        el("span", { class: "gbs-when", text: label.when }),
        el("span", { text: label.date }),
        el("span", { class: "muted", text: `${count} GBS` }),
      ]));
      group = el("div", { class: "gbs-day" });
      box.appendChild(group);
    }
    group.appendChild(upcomingLeadCard(row, flags));
  });
}

// Text messages from families (CRM "new inbound text" emails) that nobody has marked done, newest first.
// Each shows the lead(s) of the parent it came from (matched by name), so staff see who it's about.
async function renderLeadMessages(leadsById, search) {
  const box = document.getElementById("leadMessages");
  let messages = [];
  try {
    messages = await api("/api/lead-messages");
  } catch (error) {
    messages = []; // an older saved copy of the app without this route: just no list
  }
  // The search box applies here too: sender, message, or the child on a matching lead.
  const q = String(search || "").trim().toLowerCase();
  if (q) messages = messages.filter((m) => [m.from_name, m.body, ...m.leads.map((l) => l.ninja_name)].join(" ").toLowerCase().includes(q));
  setLeadsCount("messages", messages.length, true);
  box.innerHTML = "";
  if (!messages.length) {
    box.appendChild(el("div", { class: "empty-state", text: q ? "No messages match this search." : "No new messages." }));
    return;
  }
  box.appendChild(el("div", { class: "gbs-upcoming-head" }, [
    el("h3", { text: `New messages (${messages.length})` }),
    el("span", { class: "muted", text: "Texts from families, from CRM emails. Reply in the CRM, then press ✓ Done." }),
  ]));
  const grid = el("div", { class: "gbs-day" });
  messages.forEach((m) => {
    const card = el("div", { class: "gbs-card message" });
    card.appendChild(el("div", { class: "gbs-card-head" }, [
      el("div", { class: "gbs-inquiry-label" }, [
        el("span", { class: "gbs-message-tag", text: "💬 New text" }),
        el("span", { class: "muted", text: m.received ? `received ${m.received}` : "" }),
      ]),
    ]));
    // Headline: the lead(s) it's about (the child), so each message reads as that family's;
    // the parent who texted underneath. No matching lead: the parent's name is all there is.
    const leadNames = [...new Set(m.leads.map((l) => l.ninja_name).filter((n) => n && n !== NO_CHILD_NAME))];
    const who = el("div", { class: "gbs-who" }, [el("span", { class: "gbs-name", text: leadNames.join(" & ") || m.from_name })]);
    card.appendChild(who);
    if (leadNames.length) card.appendChild(el("div", { class: "gbs-parent-name", text: `Text from ${m.from_name}` }));
    card.appendChild(el("div", { class: "gbs-message-body", text: m.body || "(no message text)" }));

    // Which lead(s) it is about
    const about = el("div", { class: "gbs-message-about" });
    if (!m.leads.length) about.appendChild(el("span", { class: "muted", text: "No lead found with this parent's name." }));
    m.leads.forEach((l) => {
      const row = leadsById.get(l.id);
      const childName = l.ninja_name && l.ninja_name !== NO_CHILD_NAME ? l.ninja_name : "Child's name not found";
      const gbs = [l.gbs_date, l.gbs_time].filter(Boolean).join(" at ");
      const btn = el("button", { class: "btn-link", type: "button", title: "Open this lead",
        text: `Lead #${l.entry_number}: ${childName}` + (gbs ? ` (GBS ${gbs})` : "") });
      if (row) btn.addEventListener("click", () => openLeadModal(row)); else btn.disabled = true;
      about.appendChild(btn);
    });
    card.appendChild(about);

    if (m.original) {
      card.appendChild(el("details", { class: "gbs-original" }, [
        el("summary", { text: "Original email" }),
        el("div", { class: "gbs-original-text", text: m.original }),
      ]));
    }
    const actions = el("div", { class: "gbs-inquiry-actions" });
    if (/^https:\/\//i.test(m.reply_link || "")) {
      actions.appendChild(el("a", { class: "btn-secondary btn-small", href: m.reply_link, target: "_blank", rel: "noopener noreferrer", text: "Reply in CRM" }));
    }
    const done = el("button", { class: "btn-primary btn-small", type: "button", title: "Dealt with: take it off this list", text: "✓ Done" });
    done.addEventListener("click", async () => {
      done.disabled = true;
      try {
        await api(`/api/lead-messages/${m.id}/done`, { method: "POST" });
        loadLeads();
      } catch (error) {
        showBanner("leadsImportBanner", error.message, "error");
        done.disabled = false;
      }
    });
    actions.appendChild(done);
    card.appendChild(actions);
    grid.appendChild(card);
  });
  box.appendChild(grid);
}

// Leads that came in from CRM inquiry emails and haven't been checked yet, newest first.
function renderInquiryLeads(rows, flags, emptyText) {
  const box = document.getElementById("inquiryLeads");
  box.innerHTML = "";
  if (!rows.length) {
    box.appendChild(el("div", { class: "empty-state", text: emptyText }));
    return;
  }
  box.appendChild(el("div", { class: "gbs-upcoming-head" }, [
    el("h3", { text: `New inquiries to follow up (${rows.length})` }),
    el("span", { class: "muted", text: "Added automatically from CRM emails. Check the details against the original email, " +
      "fill in what's missing, then press ✓ Mark complete." }),
  ]));
  const grid = el("div", { class: "gbs-day" });
  [...rows].sort((a, b) => b.entry_number - a.entry_number).forEach((row) => grid.appendChild(upcomingLeadCard(row, flags, true)));
  box.appendChild(grid);
}

// ---- The parts of Leads, shown one at a time: Upcoming GBS (the default), New inquiries,
// Messages, and Past & other leads (the table, also used by Show Duplicates).
// (LEADS_VIEWS and leadsView are at the top, next to the pages.)
function applyLeadsView() {
  Object.entries(LEADS_VIEWS).forEach(([view, id]) => { document.getElementById(id).style.display = view === leadsView ? "" : "none"; });
  document.querySelectorAll("#leadsSubtabs .subtab-btn").forEach((b) => b.classList.toggle("active", b.dataset.leadsView === leadsView));
}

/** The number on a Leads tab; "attention" ones (inquiries, messages) are highlighted when not zero. */
function setLeadsCount(view, count, attention = false) {
  const btn = document.querySelector(`#leadsSubtabs [data-leads-view="${view}"]`);
  const badge = btn.querySelector(".subtab-count");
  badge.textContent = String(count);
  badge.classList.toggle("attention", attention && count > 0);
}

document.querySelectorAll("#leadsSubtabs .subtab-btn").forEach((btn) => btn.addEventListener("click", () => {
  leadsView = btn.dataset.leadsView;
  // Show Duplicates belongs to the table; leaving the table ends it.
  if (leadsView !== "table" && leadsDuplicatesOnly) { leadsDuplicatesOnly = false; loadLeads(); }
  applyLeadsView();
}));

async function loadLeads() {
  const search = document.getElementById("leadsSearch").value;
  // Upcoming GBS first (soonest at the top), then past GBS (most recent first), then no GBS date.
  const allRows = await api("/api/leads?sort=gbs");
  let rows = search.trim() ? await api("/api/leads?sort=gbs&q=" + encodeURIComponent(search)) : allRows;
  const tbody = document.querySelector("#leadsTable tbody");
  tbody.innerHTML = "";

  // Flag leads that share a phone number or email with another lead (checked against
  // every lead, not just the ones the search shows).
  const phoneCounts = {}, emailCounts = {};
  allRows.forEach((r) => {
    const p = leadPhoneKey(r.phone_number), e = leadEmailKey(r.email);
    if (p) phoneCounts[p] = (phoneCounts[p] || 0) + 1;
    if (e) emailCounts[e] = (emailCounts[e] || 0) + 1;
  });
  const isDupPhone = (r) => phoneCounts[leadPhoneKey(r.phone_number)] > 1;
  const isDupEmail = (r) => emailCounts[leadEmailKey(r.email)] > 1;
  const isDuplicate = (r) => isDupPhone(r) || isDupEmail(r);

  const dupCount = allRows.filter(isDuplicate).length;
  const dupBtn = document.getElementById("showDuplicatesBtn");
  if (!dupCount) leadsDuplicatesOnly = false;
  dupBtn.textContent = leadsDuplicatesOnly ? "Show All Leads" : `Show Duplicates (${dupCount})`;
  dupBtn.classList.toggle("active", leadsDuplicatesOnly);

  // Drop selections for rows no longer visible/existing.
  const visibleIds = new Set(rows.map((r) => r.id));
  leadsSelected = new Set([...leadsSelected].filter((id) => visibleIds.has(id)));

  // Old saved copies of the leads code ignore ?sort=gbs: show the list as-is and offer the update.
  const sortedByGbs = allRows.every((r) => r.gbs_group);
  if (!sortedByGbs) offerLatestVersion("the leads list couldn't be sorted by GBS date");
  // Each part of Leads gets its own tab (applyLeadsView shows one). New inquiries stay in their tab
  // until someone marks them complete; upcoming GBS are cards; everything else is the table.
  const searching = !!search.trim();
  const flags = { isDupPhone, isDupEmail };
  const inquiries = sortedByGbs ? rows.filter((r) => r.inquiry_status === "new") : [];
  const upcoming = sortedByGbs ? rows.filter((r) => r.gbs_group === "upcoming" && r.gbs_day && !inquiries.includes(r)) : [];
  renderUpcomingLeads(upcoming, flags, searching ? "No upcoming GBS match this search." : "No GBS coming up.");
  renderInquiryLeads(inquiries, flags, searching ? "No new inquiries match this search." : "No new inquiries to follow up.");
  renderLeadMessages(new Map(allRows.map((r) => [r.id, r])), search);
  setLeadsCount("upcoming", upcoming.length);
  setLeadsCount("inquiries", inquiries.length, true);

  if (leadsDuplicatesOnly) {
    // Only the duplicates (of every kind), with each matching group listed together.
    const groupKey = (r) => (isDupPhone(r) ? "p" + leadPhoneKey(r.phone_number) : "e" + leadEmailKey(r.email));
    rows = rows
      .filter(isDuplicate)
      .sort((a, b) => groupKey(a).localeCompare(groupKey(b)) || a.entry_number - b.entry_number);
  } else {
    rows = rows.filter((r) => !upcoming.includes(r) && !inquiries.includes(r));
  }
  setLeadsCount("table", rows.length);
  document.getElementById("leadsEmpty").style.display = rows.length ? "none" : "block";
  document.getElementById("leadsEmpty").textContent = leadsDuplicatesOnly
    ? "No duplicates match this search."
    : searching ? "No past or other leads match this search." : "No past or undated leads.";
  applyLeadsView();
  const groupCounts = {};
  rows.forEach((r) => { groupCounts[r.gbs_group] = (groupCounts[r.gbs_group] || 0) + 1; });
  const columnCount = document.querySelectorAll("#leadsTable thead th").length;
  let lastGroup = null;

  rows.forEach((row) => {
    // A heading above each group (not in the duplicates view, which is grouped by match instead).
    if (sortedByGbs && !leadsDuplicatesOnly && row.gbs_group !== lastGroup) {
      lastGroup = row.gbs_group;
      const label = `${LEAD_GROUP_TITLES[row.gbs_group] || ""} (${groupCounts[row.gbs_group]})`;
      tbody.appendChild(el("tr", { class: "leads-group-row" }, [el("td", { colspan: String(columnCount), text: label })]));
    }

    const tr = el("tr");
    const dupPhone = isDupPhone(row);
    const dupEmail = isDupEmail(row);

    const checkbox = el("input", { type: "checkbox" });
    checkbox.checked = leadsSelected.has(row.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) leadsSelected.add(row.id);
      else leadsSelected.delete(row.id);
      updateLeadsSelectionUI();
    });
    tr.appendChild(el("td", {}, [checkbox]));

    [
      row.entry_number, row.ninja_name, row.parent_name, row.phone_number,
      row.email, row.age, row.gbs_type, row.staff_name, row.coding_experience,
      row.comments, row.gbs_date, row.gbs_time, row.post_gbs_follow_up,
      row.gbs_completed, row.lead_date,
    ].forEach((value, i) => {
      const td = el("td", { text: value || "", ...(i === 9 ? { class: "comments-cell" } : {}) });
      if (i === 1 && row.enrolled) {
        const badge = el("button", { class: "enrolled-badge", type: "button", title: "This child is now a Ninja - open their page", text: "Enrolled" });
        badge.addEventListener("click", () => openNinjaProfile({ uid: row.ninja_uid }));
        td.appendChild(badge);
      }
      if ((i === 3 && dupPhone) || (i === 4 && dupEmail)) {
        td.classList.add("dup-cell");
        td.title = `Another lead has this same ${i === 3 ? "phone number" : "email"}`;
        td.appendChild(el("span", { class: "dup-badge", text: "Duplicate" }));
      }
      tr.appendChild(td);
    });

    const editBtn = el("button", { class: "btn-icon btn-edit", title: "Edit", text: "\u270e" });
    editBtn.addEventListener("click", () => openLeadModal(row));

    const delBtn = el("button", { class: "btn-icon", title: "Remove", text: "\u2716" });
    delBtn.addEventListener("click", async () => {
      const ok = await confirmDialog("Remove Entry", `Remove "${row.ninja_name}"?`);
      if (!ok) return;
      await api(`/api/leads/${row.id}`, { method: "DELETE" });
      loadLeads();
    });
    tr.appendChild(el("td", { class: "actions-cell" }, [editBtn, delBtn]));

    tbody.appendChild(tr);
  });

  document.getElementById("leadsSelectAll").checked =
    rows.length > 0 && rows.every((r) => leadsSelected.has(r.id));

  updateLeadsSelectionUI();
}

function updateLeadsSelectionUI() {
  const count = leadsSelected.size;
  document.getElementById("leadsSelectionCount").textContent =
    count > 0 ? `${count} selected` : "";
  document.getElementById("deleteSelectedLeadsBtn").style.display =
    count > 0 ? "inline-block" : "none";
}

document.getElementById("leadsSearch").addEventListener("input", () => loadLeads());

document.getElementById("showDuplicatesBtn").addEventListener("click", () => {
  leadsDuplicatesOnly = !leadsDuplicatesOnly;
  if (leadsDuplicatesOnly) leadsView = "table"; // duplicates are shown in the table
  loadLeads();
});

document.getElementById("leadsSelectAll").addEventListener("change", (e) => {
  document.querySelectorAll("#leadsTable tbody tr").forEach((tr) => {
    const cb = tr.querySelector("input[type=checkbox]");
    if (cb) cb.checked = e.target.checked;
  });
  if (e.target.checked) {
    document.querySelectorAll("#leadsTable tbody tr").forEach((tr) => {
      const cb = tr.querySelector("input[type=checkbox]");
      if (cb) cb.dispatchEvent(new Event("change"));
    });
  } else {
    leadsSelected.clear();
    updateLeadsSelectionUI();
    document.querySelectorAll("#leadsTable tbody tr input[type=checkbox]").forEach((cb) => {
      cb.checked = false;
    });
  }
});

document.getElementById("deleteSelectedLeadsBtn").addEventListener("click", async () => {
  const count = leadsSelected.size;
  const ok = await confirmDialog(
    "Delete Selected Leads",
    `Permanently delete ${count} selected lead${count === 1 ? "" : "s"}? This cannot be undone.`
  );
  if (!ok) return;
  await api("/api/leads/bulk-delete", {
    method: "POST",
    body: JSON.stringify({ ids: [...leadsSelected] }),
  });
  leadsSelected.clear();
  loadLeads();
});

document.getElementById("deleteAllLeadsBtn").addEventListener("click", async () => {
  const ok = await confirmDialog(
    "Delete ALL Leads",
    "This permanently deletes every lead entry in the system. This cannot be undone. Are you sure?"
  );
  if (!ok) return;
  const ok2 = await confirmDialog(
    "Are you REALLY sure?",
    "Last check - this deletes everything in the Leads table. Continue?"
  );
  if (!ok2) return;
  await api("/api/leads/bulk-delete", { method: "POST", body: JSON.stringify({ all: true }) });
  leadsSelected.clear();
  loadLeads();
});

// ---- Print Totem Tags ----

document.getElementById("printTotemTagsBtn").addEventListener("click", async () => {
  hideBanner("leadsImportBanner");

  let payload;
  let count;

  if (leadsSelected.size > 0) {
    payload = { ids: [...leadsSelected] };
    count = leadsSelected.size;
  } else {
    const ok = await confirmDialog(
      "Print Totem Tags",
      "Nothing is selected, so this will print a tag for every Ninja currently in the Leads list. Continue?"
    );
    if (!ok) return;
    payload = { all: true };
  }

  try {
    const result = await api("/api/leads/totem-tags", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    showBanner(
      "leadsImportBanner",
      `Generated ${result.count} totem tag${result.count === 1 ? "" : "s"}. Downloading...`,
      "success"
    );
    openDownload(result);
  } catch (error) {
    showBanner("leadsImportBanner", error.message, "error");
  }
});

// ---- Import CSV (Leads) ----

document.getElementById("importLeadsBtn").addEventListener("click", () => {
  document.getElementById("importLeadsFile").click();
});

document.getElementById("importLeadsFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  hideBanner("leadsImportBanner");

  try {
    const result = await apiUpload("/api/leads/import", file);
    showImportResult("leadsImportBanner", result, "imported");
    if (result.successCount > 0) loadLeads();
  } catch (error) {
    showBanner("leadsImportBanner", error.message, "error");
  } finally {
    e.target.value = "";
  }
});

// ---- Add Lead modal ----

function buildLeadForm(row) {
  const container = document.getElementById("leadFormFields");
  container.innerHTML = "";

  LEAD_FIELD_DEFS.forEach((field) => {
    const wrap = el("div", { class: "field" + (field.full ? " full" : "") });
    wrap.appendChild(el("label", { for: "lf_" + field.id, text: field.title }));

    const current = row ? (row[field.id] || "") : "";

    let input;
    if (field.type === "select") {
      input = el("select", { id: "lf_" + field.id });
      input.appendChild(el("option", { value: "", text: "-- Select --" }));
      const options = (settings[field.settingsKey] || []).slice();
      // Keep an existing value even if it's no longer in the Settings list.
      if (current && !options.includes(current)) options.push(current);
      options.forEach((opt) => {
        input.appendChild(el("option", { value: opt, text: opt }));
      });
      input.value = current;
    } else {
      input = el("input", { type: "text", id: "lf_" + field.id });
      input.value = current;
    }

    wrap.appendChild(input);
    container.appendChild(wrap);
  });
}

function openLeadModal(row) {
  // Called as a click handler it receives an Event, not a row.
  row = row && row.id !== undefined ? row : null;
  editingLeadId = row ? row.id : null;
  document.getElementById("leadModalTitle").textContent = row ? "Edit Ninja Entry" : "Add Ninja Entry";
  document.getElementById("leadModalSubmit").textContent = row ? "Save Changes" : "Add Entry";
  buildLeadForm(row);
  hideBanner("leadFormError");
  document.getElementById("leadModalOverlay").classList.add("open");
}

function closeLeadModal() {
  document.getElementById("leadModalOverlay").classList.remove("open");
}

document.getElementById("addLeadBtn").addEventListener("click", () => openLeadModal(null));
document.getElementById("leadModalCancel").addEventListener("click", closeLeadModal);

document.getElementById("leadModalSubmit").addEventListener("click", async () => {
  const data = {};
  LEAD_FIELD_DEFS.forEach((field) => {
    data[field.id] = document.getElementById("lf_" + field.id).value;
  });

  const btn = document.getElementById("leadModalSubmit");
  btn.disabled = true;

  try {
    if (editingLeadId) {
      await api(`/api/leads/${editingLeadId}`, { method: "PUT", body: JSON.stringify(data) });
    } else {
      try {
        await api("/api/leads", { method: "POST", body: JSON.stringify(data) });
      } catch (error) {
        if (error.status !== 409) throw error;
        const ok = await confirmDialog("Possible Duplicate", error.message + "\n\nAdd this entry anyway?");
        if (!ok) return;
        await api("/api/leads", { method: "POST", body: JSON.stringify({ ...data, allow_duplicate: true }) });
      }
    }
    closeLeadModal();
    loadLeads();
  } catch (error) {
    showBanner("leadFormError", error.message, "error");
  } finally {
    btn.disabled = false;
  }
});

// ---- Bulk Add Leads modal ----

function openBulkLeadModal() {
  document.getElementById("bulkLeadOrder").textContent =
    "Column order: " + LEAD_FIELD_DEFS.map((f) => f.title).join(" \u2192 ");
  document.getElementById("bulkLeadText").value = "";
  hideBanner("bulkLeadBanner");
  document.getElementById("bulkLeadModalOverlay").classList.add("open");
}

document.getElementById("bulkAddLeadsBtn").addEventListener("click", openBulkLeadModal);
document.getElementById("bulkLeadCancel").addEventListener("click", () => {
  document.getElementById("bulkLeadModalOverlay").classList.remove("open");
});

document.getElementById("bulkLeadSubmit").addEventListener("click", async () => {
  const text = document.getElementById("bulkLeadText").value;
  const btn = document.getElementById("bulkLeadSubmit");
  btn.disabled = true;

  try {
    const result = await api("/api/leads/bulk", { method: "POST", body: JSON.stringify({ text }) });
    showImportResult("bulkLeadBanner", result, "added");
    if (result.successCount > 0) {
      document.getElementById("bulkLeadText").value = "";
      loadLeads();
    }
  } catch (error) {
    showBanner("bulkLeadBanner", error.message, "error");
  } finally {
    btn.disabled = false;
  }
});

// ================================================================
// BELTS
// ================================================================

async function loadBelts() {
  const search = document.getElementById("beltsSearch").value;
  const rows = await api("/api/belts?q=" + encodeURIComponent(search));
  beltsRowsCache = rows;
  const tbody = document.querySelector("#beltsTable tbody");
  tbody.innerHTML = "";

  document.getElementById("beltsEmpty").style.display = rows.length ? "none" : "block";

  const visibleIds = new Set(rows.map((r) => r.id));
  beltsSelected = new Set([...beltsSelected].filter((id) => visibleIds.has(id)));

  rows.forEach((row) => {
    const tr = el("tr");

    const checkbox = el("input", { type: "checkbox" });
    checkbox.checked = beltsSelected.has(row.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) beltsSelected.add(row.id);
      else beltsSelected.delete(row.id);
      updateBeltsSelectionUI();
    });
    tr.appendChild(el("td", {}, [checkbox]));

    tr.appendChild(el("td", {}, [ninjaLink(row.name, row.ninja_uid)]));
    [row.old_belt, row.new_belt, (row.created_at || "").slice(0, 10)]
      .forEach((value) => tr.appendChild(el("td", { text: value || "" })));

    const actions = [];
    if (certificateBeltsForEntry(row).length) {
      const certBtn = el("button", { class: "btn-icon", title: "Print certificate(s)", text: "\ud83c\udf93" });
      certBtn.addEventListener("click", () => openBeltCertModal(row));
      actions.push(certBtn);
    }

    const editBtn = el("button", { class: "btn-icon btn-edit", title: "Edit", text: "\u270e" });
    editBtn.addEventListener("click", () => openBeltModal(row));

    const delBtn = el("button", { class: "btn-icon", title: "Remove", text: "\u2716" });
    delBtn.addEventListener("click", async () => {
      const ok = await confirmDialog("Remove Entry", `Remove this entry for "${row.name}"?`);
      if (!ok) return;
      await api(`/api/belts/${row.id}`, { method: "DELETE" });
      loadBelts();
    });
    tr.appendChild(el("td", { class: "actions-cell" }, [...actions, editBtn, delBtn]));

    tbody.appendChild(tr);
  });

  document.getElementById("beltsSelectAll").checked =
    rows.length > 0 && rows.every((r) => beltsSelected.has(r.id));

  updateBeltsSelectionUI();
}

function updateBeltsSelectionUI() {
  const count = beltsSelected.size;
  document.getElementById("beltsSelectionCount").textContent =
    count > 0 ? `${count} selected` : "";
  document.getElementById("deleteSelectedBeltsBtn").style.display =
    count > 0 ? "inline-block" : "none";
}

document.getElementById("beltsSearch").addEventListener("input", () => loadBelts());

document.getElementById("beltsSelectAll").addEventListener("change", (e) => {
  if (e.target.checked) {
    document.querySelectorAll("#beltsTable tbody tr input[type=checkbox]").forEach((cb) => {
      cb.checked = true;
      cb.dispatchEvent(new Event("change"));
    });
  } else {
    beltsSelected.clear();
    updateBeltsSelectionUI();
    document.querySelectorAll("#beltsTable tbody tr input[type=checkbox]").forEach((cb) => {
      cb.checked = false;
    });
  }
});

document.getElementById("deleteSelectedBeltsBtn").addEventListener("click", async () => {
  const count = beltsSelected.size;
  const ok = await confirmDialog(
    "Delete Selected Belt Entries",
    `Permanently delete ${count} selected entr${count === 1 ? "y" : "ies"}? This cannot be undone.`
  );
  if (!ok) return;
  await api("/api/belts/bulk-delete", {
    method: "POST",
    body: JSON.stringify({ ids: [...beltsSelected] }),
  });
  beltsSelected.clear();
  loadBelts();
});

document.getElementById("deleteAllBeltsBtn").addEventListener("click", async () => {
  const ok = await confirmDialog(
    "Delete ALL Belt Entries",
    "This permanently deletes every belt entry in the system. This cannot be undone. Are you sure?"
  );
  if (!ok) return;
  const ok2 = await confirmDialog(
    "Are you REALLY sure?",
    "Last check - this deletes everything in the Belt-ups listle. Continue?"
  );
  if (!ok2) return;
  await api("/api/belts/bulk-delete", { method: "POST", body: JSON.stringify({ all: true }) });
  beltsSelected.clear();
  loadBelts();
});

document.getElementById("printTotemTagsBeltsBtn").addEventListener("click", () => {
  printTotemTagsForNames(
    beltsRowsCache.filter((r) => beltsSelected.has(r.id)).map((r) => r.name),
    beltsRowsCache.map((r) => r.name),
    "beltsImportBanner",
    "the Belts list"
  );
});

// ---- Import CSV (Belts) ----

document.getElementById("importBeltsBtn").addEventListener("click", () => {
  document.getElementById("importBeltsFile").click();
});

document.getElementById("importBeltsFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  hideBanner("beltsImportBanner");

  try {
    const result = await apiUpload("/api/belts/import", file);
    if (result.preview) {
      // A MyStudio belt / rank list: reviewed in the same window as the Active Ninjas import.
      openRosterReview(result, "beltsImportBanner");
      return;
    }
    showImportResult("beltsImportBanner", result, "imported");
    if (result.successCount > 0) loadBelts();
  } catch (error) {
    showBanner("beltsImportBanner", error.message, "error");
  } finally {
    e.target.value = "";
  }
});

function buildBeltForm(row) {
  const container = document.getElementById("beltFormFields");
  container.innerHTML = "";

  const nameWrap = el("div", { class: "field full" });
  nameWrap.appendChild(el("label", { for: "bf_name", text: "Name" }));
  const nameInput = el("input", { type: "text", id: "bf_name" });
  nameInput.value = row ? row.name || "" : "";
  nameWrap.appendChild(nameInput);
  container.appendChild(nameWrap);

  ["old_belt", "new_belt"].forEach((id) => {
    const wrap = el("div", { class: "field" });
    wrap.appendChild(el("label", { for: "bf_" + id, text: id === "old_belt" ? "Old Belt" : "New Belt" }));
    const select = el("select", { id: "bf_" + id });
    select.appendChild(el("option", { value: "", text: "-- Select --" }));
    const current = row ? row[id] || "" : "";
    const options = (settings.belt_options || []).slice();
    if (current && !options.includes(current)) options.push(current);
    options.forEach((opt) => {
      select.appendChild(el("option", { value: opt, text: opt }));
    });
    select.value = current;
    wrap.appendChild(select);
    container.appendChild(wrap);
  });
}

function openBeltModal(row) {
  row = row && row.id !== undefined ? row : null;
  editingBeltId = row ? row.id : null;
  document.getElementById("beltModalTitle").textContent = row ? "Edit Belt Entry" : "Add Belt Entry";
  document.getElementById("beltModalSubmit").textContent = row ? "Save Changes" : "Add Entry";
  buildBeltForm(row);
  hideBanner("beltFormError");
  document.getElementById("beltModalOverlay").classList.add("open");
}

document.getElementById("addBeltBtn").addEventListener("click", () => openBeltModal(null));
document.getElementById("beltModalCancel").addEventListener("click", () => {
  document.getElementById("beltModalOverlay").classList.remove("open");
});

document.getElementById("beltModalSubmit").addEventListener("click", async () => {
  const data = {
    name: document.getElementById("bf_name").value,
    old_belt: document.getElementById("bf_old_belt").value,
    new_belt: document.getElementById("bf_new_belt").value,
  };

  const btn = document.getElementById("beltModalSubmit");
  btn.disabled = true;

  try {
    if (editingBeltId) {
      await api(`/api/belts/${editingBeltId}`, { method: "PUT", body: JSON.stringify(data) });
    } else {
      const added = await api("/api/belts", { method: "POST", body: JSON.stringify(data) });
      const moved = (added && added.beltsUpdated) || [];
      if (moved.length) {
        showBanner("beltsImportBanner", "Active Ninjas belt updated: " +
          moved.map((f) => (f.was ? `${f.name} (${f.was} \u2192 ${f.belt})` : `${f.name} (${f.belt})`)).join(", "), "success");
      }
    }
    document.getElementById("beltModalOverlay").classList.remove("open");
    loadBelts();
  } catch (error) {
    showBanner("beltFormError", error.message, "error");
  } finally {
    btn.disabled = false;
  }
});

const PRINTED_NOTE = "They are marked as printed; press \u2713 Given on Rewards owed once each one is handed out.";

// ---- Print certificates for one belt entry ----
// Same rule as getOutstandingCertificates: one certificate per belt completed,
// so Yellow -> Green covers Yellow and Orange.

let beltCertRow = null;

function normalizeBelt(belt) {
  return String(belt || "").trim().toLowerCase().replace(/\s+belts?$/, "").trim();
}

function certificateBeltsForEntry(row) {
  const order = (settings.belt_options || []).map(normalizeBelt).filter(Boolean);
  const oldIndex = order.indexOf(normalizeBelt(row.old_belt));
  const newIndex = order.indexOf(normalizeBelt(row.new_belt));
  if (oldIndex < 0 || newIndex <= oldIndex) return [];
  return order.slice(oldIndex, newIndex).map(formatBeltName);
}

// Opens the certificate picker for one Ninja. Owed certificates start ticked; ones already
// printed are listed too, so a lost certificate can be printed again.
// opts: { bannerId: where errors/success go, intro: text above the list, onDone: after printing }
async function openCertPicker(name, belts, opts) {
  hideBanner(opts.bannerId);
  let outstanding;
  try {
    outstanding = await api("/api/certificates/outstanding");
  } catch (error) {
    showBanner(opts.bannerId, error.message, "error");
    return;
  }
  const owed = new Set(outstanding
    .filter((item) => personKey(item.name) === personKey(name))
    .map((item) => item.belt));

  beltCertRow = { name, bannerId: opts.bannerId, onDone: opts.onDone };
  document.getElementById("beltCertModalTitle").textContent = `Print Certificates - ${name}`;
  document.getElementById("beltCertIntro").textContent =
    opts.intro || "One certificate per belt completed. Tick the ones to print.";
  const container = document.getElementById("beltCertOptions");
  container.innerHTML = "";
  belts.forEach((belt) => {
    const checkbox = el("input", { type: "checkbox", value: belt });
    checkbox.checked = owed.has(belt);
    const text = owed.has(belt) ? `${belt} Belt` : `${belt} Belt (already printed)`;
    container.appendChild(el("label", {}, [checkbox, el("span", { text })]));
  });
  hideBanner("beltCertError");
  document.getElementById("beltCertModalOverlay").classList.add("open");
}

function openBeltCertModal(row) {
  return openCertPicker(row.name, certificateBeltsForEntry(row), { bannerId: "beltsImportBanner" });
}

document.getElementById("beltCertCancel").addEventListener("click", () => {
  document.getElementById("beltCertModalOverlay").classList.remove("open");
});

document.getElementById("beltCertSubmit").addEventListener("click", async () => {
  const belts = [...document.querySelectorAll("#beltCertOptions input:checked")].map((cb) => cb.value);
  if (!belts.length) {
    showBanner("beltCertError", "Tick at least one certificate to print.", "error");
    return;
  }
  const btn = document.getElementById("beltCertSubmit");
  btn.disabled = true;
  try {
    const result = await api("/api/certificates/generate", {
      method: "POST",
      body: JSON.stringify({ name: beltCertRow.name, belts }),
    });
    document.getElementById("beltCertModalOverlay").classList.remove("open");
    showBanner(beltCertRow.bannerId, `Generated ${result.count} certificate(s) for ${beltCertRow.name}. Downloading... ` + PRINTED_NOTE, "success");
    openDownload(result);
    if (beltCertRow.onDone) beltCertRow.onDone();
  } catch (error) {
    showBanner("beltCertError", error.message, "error");
  } finally {
    btn.disabled = false;
  }
});

// ---- Bulk Add Belts modal ----

document.getElementById("bulkAddBeltsBtn").addEventListener("click", () => {
  document.getElementById("bulkBeltText").value = "";
  hideBanner("bulkBeltBanner");
  document.getElementById("bulkBeltModalOverlay").classList.add("open");
});

document.getElementById("bulkBeltCancel").addEventListener("click", () => {
  document.getElementById("bulkBeltModalOverlay").classList.remove("open");
});

document.getElementById("bulkBeltSubmit").addEventListener("click", async () => {
  const text = document.getElementById("bulkBeltText").value;
  const btn = document.getElementById("bulkBeltSubmit");
  btn.disabled = true;

  try {
    const result = await api("/api/belts/bulk", { method: "POST", body: JSON.stringify({ text }) });
    showImportResult("bulkBeltBanner", result, "added");
    if (result.successCount > 0) {
      document.getElementById("bulkBeltText").value = "";
      loadBelts();
    }
  } catch (error) {
    showBanner("bulkBeltBanner", error.message, "error");
  } finally {
    btn.disabled = false;
  }
});

// ================================================================
// REWARDS
// ================================================================

const REWARD_COLUMNS = [
  ["ninja_bucks_remaining", "ninja_bucks"],
  ["prints_remaining", "prints"],
  ["certificates_remaining", "certificates"],
  ["belts_remaining", "belts"],
];

const OVERALL_LABELS = {
  ninja_bucks: "Ninja Bucks",
  prints: "3D Prints",
  certificates: "Certificates",
  belts: "New Belts",
};

// The day picker: "Every day", then each day with how many Ninjas come in. Keeps the current pick.
function fillRewardsDays(days) {
  const select = document.getElementById("rewardsDay");
  const picked = select.value;
  select.innerHTML = "";
  select.appendChild(el("option", { value: "", text: "Every day" }));
  days.forEach(({ day, ninjas }) => select.appendChild(el("option", { value: day, text: `${day} (${ninjas})` })));
  select.value = days.some((d) => d.day === picked) ? picked : "";
}

async function loadRewards() {
  hideBanner("rewardsBanner");
  const picked = document.getElementById("rewardsDay").value;
  const [summary, byDay, printed] = await Promise.all([
    api("/api/rewards/summary"),
    api(`/api/rewards/by-day${picked ? `?day=${encodeURIComponent(picked)}` : ""}`),
    api("/api/certificates/printed"),
  ]);
  fillRewardsDays(byDay.days);
  const day = document.getElementById("rewardsDay").value ? byDay : null;
  renderPrintedCertificates(printed, day);

  const totalsContainer = document.getElementById("rewardsTotals");
  totalsContainer.innerHTML = "";
  const caughtUp = document.getElementById("rewardsDayCaughtUp");
  caughtUp.style.display = "none";

  if (day) {
    renderDayRewards(day, totalsContainer, caughtUp);
    return;
  }

  const levelsCard = el("div", { class: "totals-card" });
  levelsCard.appendChild(el("div", { class: "totals-card-label", text: "Levels Progressed" }));
  levelsCard.appendChild(el("div", { class: "totals-card-value", text: String(summary.overall.levels_progressed) }));
  totalsContainer.appendChild(levelsCard);

  Object.keys(OVERALL_LABELS).forEach((field) => {
    const data = summary.overall[field];
    const card = el("div", { class: "totals-card" });
    card.appendChild(el("div", { class: "totals-card-label", text: OVERALL_LABELS[field] }));
    card.appendChild(el("div", { class: "totals-card-value", text: String(data.remaining) }));
    let sub = `${data.given} given / ${data.earned} earned`;
    if (field === "certificates" && data.printed) sub = `${data.printed} printed, not handed out · ` + sub;
    card.appendChild(el("div", { class: "totals-card-sub", text: sub }));
    totalsContainer.appendChild(card);
  });

  renderRewardRows(summary.rows, "Everyone is all caught up - nothing outstanding.");
}

// One day picked: cards total what that day's Ninjas are owed; the table lists just them.
function renderDayRewards(day, totalsContainer, caughtUp) {
  const card = (label, value, sub) => el("div", { class: "totals-card" }, [
    el("div", { class: "totals-card-label", text: label }),
    el("div", { class: "totals-card-value", text: String(value) }),
    el("div", { class: "totals-card-sub", text: sub }),
  ]);
  totalsContainer.appendChild(card(`${day.day} Ninjas owed`, day.owed_count, `of ${day.attending} who come in`));
  Object.keys(OVERALL_LABELS).forEach((field) => {
    const printed = field === "certificates" && day.totals.certificates_printed;
    totalsContainer.appendChild(card(OVERALL_LABELS[field], day.totals[field],
      printed ? `owed on ${day.day} · ${printed} printed` : `owed on ${day.day}`));
  });

  const nothingOwed = day.ninjas.filter((n) => !n.owed).map((n) => n.name);
  if (nothingOwed.length) {
    caughtUp.textContent = `Also in on ${day.day}, nothing owed: ${nothingOwed.join(", ")}.`;
    caughtUp.style.display = "block";
  }
  renderRewardRows(day.rows, day.attending
    ? `Every ${day.day} Ninja is all caught up - nothing outstanding.`
    : `No Ninjas have a class on ${day.day}.`);
}

function renderRewardRows(allRows, nothingText) {
  const tbody = document.querySelector("#rewardsTable tbody");
  tbody.innerHTML = "";

  const search = document.getElementById("rewardsSearch").value;
  const rows = allRows.filter((row) =>
    matchesSearch([row.name, row.progression, ...(row.time_slots || []), ...REWARD_COLUMNS.map(([key]) => row[key])], search));
  const empty = document.getElementById("rewardsEmpty");
  empty.style.display = rows.length ? "none" : "block";
  empty.textContent = allRows.length ? "No rewards match this search." : nothingText;

  rewardsRowsCache = rows;

  rows.forEach((row) => {
    const tr = el("tr");
    const nameCell = el("td", {}, [ninjaLink(row.name)]);
    // With a day picked, show when they come in that day.
    if (row.time_slots && row.time_slots.length) {
      nameCell.appendChild(el("div", { class: "muted", text: row.time_slots.join(", ") }));
    }
    tr.appendChild(nameCell);
    tr.appendChild(el("td", { text: row.progression }));
    REWARD_COLUMNS.forEach(([key]) => {
      const td = el("td", { class: row[key] ? "" : "zero", text: String(row[key]) });
      if (key === "certificates_remaining" && row.certificates_printed) {
        td.appendChild(el("div", { class: "cert-printed-note", text: `${row.certificates_printed} printed` }));
      }
      tr.appendChild(td);
    });

    const actionsCell = el("td");
    const giveBtn = el("button", { class: "btn-icon", title: `Give rewards to ${row.name}`, text: "🎁" });
    giveBtn.addEventListener("click", () => openGiveRewards(row.name, row));
    actionsCell.appendChild(giveBtn);
    if (row.certificates_remaining > row.certificates_printed) {
      const certBtn = el("button", { class: "btn-icon", title: "Print certificate(s)", text: "\ud83c\udf93" });
      certBtn.addEventListener("click", () => generateCertificateForRow(row));
      actionsCell.appendChild(certBtn);
    }
    tr.appendChild(actionsCell);

    tbody.appendChild(tr);
  });
}

// Certificates printed but not handed out yet (only that day's Ninjas when a day is picked).
function renderPrintedCertificates(printed, day) {
  const box = document.getElementById("certReady");
  const list = document.getElementById("certReadyList");
  const names = day ? new Set(day.rows.map((r) => personKey(r.name))) : null;
  const shown = names ? printed.filter((c) => names.has(personKey(c.name))) : printed;
  box.style.display = shown.length ? "" : "none";
  document.getElementById("certReadyCount").textContent = String(shown.length);
  list.innerHTML = "";
  shown.forEach((c) => {
    const btn = el("button", { class: "btn-secondary btn-small", type: "button", title: `Mark ${c.belt} certificate as handed out to ${c.name}`, text: "\u2713 Given" });
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await api("/api/certificates/given", { method: "POST", body: JSON.stringify({ items: [{ name: c.name, belt: c.belt }] }) });
        showBanner("rewardsBanner", `${c.belt} Belt certificate marked as given to ${c.name}.`, "success");
        loadRewards();
      } catch (error) {
        showBanner("rewardsBanner", error.message, "error");
        btn.disabled = false;
      }
    });
    list.appendChild(el("div", { class: "cert-ready-item" }, [
      el("div", {}, [ninjaLink(c.name), el("div", { class: "muted", text: `${c.belt} Belt · printed ${c.date}` })]),
      btn,
    ]));
  });
}

document.getElementById("refreshRewardsBtn").addEventListener("click", loadRewards);
document.getElementById("rewardsSearch").addEventListener("input", () => loadRewards());
document.getElementById("rewardsDay").addEventListener("change", () => loadRewards());

document.getElementById("printTotemTagsRewardsBtn").addEventListener("click", () => {
  printTotemTagsForNames(
    [],
    rewardsRowsCache.map((r) => r.name),
    "rewardsBanner",
    "the Rewards list"
  );
});

async function generateCertificateForRow(row) {
  hideBanner("rewardsBanner");
  try {
    const outstanding = await api("/api/certificates/outstanding");
    const belts = outstanding
      .filter((item) => item.name === row.name)
      .map((item) => item.belt);

    if (belts.length === 0) {
      showBanner("rewardsBanner", `No outstanding certificates found for ${row.name}.`, "error");
      return;
    }

    const result = await api("/api/certificates/generate", {
      method: "POST",
      body: JSON.stringify({ name: row.name, belts }),
    });

    showBanner("rewardsBanner", `Generated ${result.count} certificate(s) for ${row.name}. Downloading... ` + PRINTED_NOTE, "success");
    openDownload(result);
    loadRewards();
  } catch (error) {
    showBanner("rewardsBanner", error.message, "error");
  }
}

document.getElementById("generateAllCertsBtn").addEventListener("click", async () => {
  hideBanner("rewardsBanner");
  try {
    const result = await api("/api/certificates/generate", {
      method: "POST",
      body: JSON.stringify({ generate_all: true }),
    });
    showBanner("rewardsBanner", `Generated ${result.count} certificate(s). Downloading... ` + PRINTED_NOTE, "success");
    openDownload(result);
    loadRewards();
  } catch (error) {
    showBanner("rewardsBanner", error.message, "error");
  }
});

// ---- Give Rewards modal ----

const GIVE_FIELDS = ["ninja_bucks", "prints", "certificates", "belts"];

// name/row are set when opened from a Ninja's row: the name is filled in and what they are
// still owed is shown under each box.
function openGiveRewards(name, row) {
  document.getElementById("gr_names").value = name || "";
  GIVE_FIELDS.forEach((field) => {
    document.getElementById("gr_" + field).value = "0";
    document.getElementById("gr_owed_" + field).textContent = !row ? "" :
      `${row[field + "_remaining"]} owed` + (field === "certificates" && row.certificates_printed ? ` (${row.certificates_printed} printed)` : "");
  });
  hideBanner("giveRewardsError");
  document.getElementById("giveRewardsModalOverlay").classList.add("open");
}

document.getElementById("giveRewardsBtn").addEventListener("click", () => openGiveRewards());

document.getElementById("giveRewardsCancel").addEventListener("click", () => {
  document.getElementById("giveRewardsModalOverlay").classList.remove("open");
});

document.getElementById("giveRewardsSubmit").addEventListener("click", async () => {
  const names = document.getElementById("gr_names").value
    .split(",").map((n) => n.trim()).filter(Boolean);

  const payload = { names };
  GIVE_FIELDS.forEach((field) => {
    payload[field] = Number(document.getElementById("gr_" + field).value || 0);
  });

  const btn = document.getElementById("giveRewardsSubmit");
  btn.disabled = true;

  try {
    // Certificates here are ones handed out; printing (or reprinting a lost one) is the 🎓 button.
    await api("/api/rewards/give", { method: "POST", body: JSON.stringify(payload) });
    document.getElementById("giveRewardsModalOverlay").classList.remove("open");
    loadRewards();
  } catch (error) {
    showBanner("giveRewardsError", error.message, "error");
  } finally {
    btn.disabled = false;
  }
});

// ================================================================
// REWARD HISTORY
// ================================================================

async function loadHistory() {
  const all = await api("/api/rewards/history");
  const search = document.getElementById("historySearch").value;
  const rows = all.filter((row) =>
    matchesSearch([row.date, row.name, row.reward_type, row.amount, row.details, row.entry_type], search));
  const tbody = document.querySelector("#historyTable tbody");
  tbody.innerHTML = "";

  const empty = document.getElementById("historyEmpty");
  empty.style.display = rows.length ? "none" : "block";
  empty.textContent = all.length ? "No rewards match this search." : "No rewards have been recorded yet.";

  rows.forEach((row) => {
    const tr = el("tr");
    tr.appendChild(el("td", { text: row.date || "" }));
    tr.appendChild(el("td", {}, [ninjaLink(row.name, row.ninja_uid)]));
    [row.reward_type, row.amount, row.details, row.entry_type]
      .forEach((value) => tr.appendChild(el("td", { text: value || "" })));

    const delBtn = el("button", { class: "btn-icon", title: "Undo this transaction", text: "\u2716" });
    delBtn.addEventListener("click", async () => {
      const ok = await confirmDialog(
        "Undo Reward",
        `Remove this "${row.reward_type}" (${row.amount}) transaction for ${row.name}? This will make it owed again.`
      );
      if (!ok) return;
      await api(`/api/rewards/history/${row.id}`, { method: "DELETE" });
      loadHistory();
    });
    tr.appendChild(el("td", {}, [delBtn]));

    tbody.appendChild(tr);
  });
}

document.getElementById("clearCertificatesBtn").addEventListener("click", async () => {
  const ok = await confirmDialog(
    "Remove All Certificates",
    "Remove every certificate record (printed and given) from Reward History? All certificates will show as owed and not printed again. This cannot be undone."
  );
  if (!ok) return;
  try {
    const result = await api("/api/rewards/history/clear-certificates", { method: "POST" });
    showBanner("historyBanner", `Removed ${result.deleted} certificate transaction(s).`, "success");
  } catch (error) {
    showBanner("historyBanner", error.message, "error");
  }
  loadHistory();
});

document.getElementById("refreshHistoryBtn").addEventListener("click", loadHistory);
document.getElementById("historySearch").addEventListener("input", () => loadHistory());

// ================================================================
// 3D PRINT QUEUE (Belts & Rewards -> 3D print queue; rules in js/api/prints.js)
// ================================================================

let printsView = "queued";   // "queued" | "printed"
let editingPrint = null;     // the print in the add/edit window (null = adding)
let printedFor = null;       // the print in the "mark as printed" window
const PRINT_FILE_LIMIT = 2 * 1024 * 1024; // same as MAX_FILE_BYTES in js/lib/print_queue.js

const todayInput = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const printSizeText = (bytes) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} bytes`;
const printTitle = (p) => p.description || p.file_name || "3D print";

// Saves a print's file to the computer.
async function downloadPrintFile(print, bannerId) {
  try {
    const file = await api(`/api/prints/${print.id}/file`);
    const raw = atob(file.file_data);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    // Always saved as a download, never opened in the page.
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const link = el("a", { href: url, download: file.file_name || "model" });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    showBanner(bannerId, error.message, "error");
  }
}

// The link and/or file of a print, as small buttons.
function printModelCell(print, bannerId) {
  const cell = el("div", { class: "print-model" });
  if (print.model_link) {
    let host = print.model_link;
    try { host = new URL(print.model_link).hostname.replace(/^www\./, ""); } catch (_) { /* shown as is */ }
    cell.appendChild(el("a", { href: print.model_link, target: "_blank", rel: "noopener noreferrer", title: print.model_link, text: `🔗 ${host}` }));
  }
  if (print.has_file) {
    const btn = el("button", { class: "link-btn", type: "button", title: "Save the model file", text: `⬇ ${print.file_name} (${printSizeText(print.file_size || 0)})` });
    btn.addEventListener("click", () => downloadPrintFile(print, bannerId));
    cell.appendChild(btn);
  }
  if (!cell.childNodes.length) cell.appendChild(el("span", { class: "muted", text: "No link or file yet" }));
  return cell;
}

async function loadPrints() {
  let data;
  try {
    data = await api("/api/prints");
  } catch (error) {
    showBanner("printsBanner", error.message, "error");
    return;
  }
  const queued = printsView === "queued";
  document.getElementById("printsQueuedBtn").classList.toggle("active", queued);
  document.getElementById("printsPrintedBtn").classList.toggle("active", !queued);
  document.getElementById("printsQueuedBtn").textContent = `Queue (${data.queued.length})`;
  document.getElementById("printsPrintedBtn").textContent = `Printed (${data.printed.length})`;
  document.getElementById("printsDateHead").textContent = queued ? "Promised" : "Printed";

  const all = queued ? data.queued : data.printed;
  const search = document.getElementById("printsSearch").value;
  const rows = all.filter((p) => matchesSearch([p.name, p.description, p.file_name, p.model_link, p.promised_date, p.printed_date], search));
  document.getElementById("printsCountLabel").textContent = queued && data.queued.length
    ? `Up next: ${data.queued[0].name} (${printTitle(data.queued[0])})` : "";

  const empty = document.getElementById("printsEmpty");
  empty.style.display = rows.length ? "none" : "block";
  empty.textContent = all.length ? "No prints match this search."
    : queued ? "No prints waiting. Press \"+ Add a print\" when a Ninja picks one." : "Nothing has been printed yet.";

  const tbody = document.querySelector("#printsTable tbody");
  tbody.innerHTML = "";
  rows.forEach((p) => {
    const tr = el("tr", { class: queued && p.position === 1 ? "print-next" : "" });
    tr.appendChild(el("td", { class: "print-pos", text: queued ? String(p.position) : "" }));
    const who = el("td", {}, [ninjaLink(p.name, p.ninja_uid)]);
    if (queued && p.position === 1) who.appendChild(el("div", { class: "print-next-badge", text: "Up next" }));
    tr.appendChild(who);
    tr.appendChild(el("td", { class: "print-desc", text: p.description || "" }));
    tr.appendChild(el("td", {}, [printModelCell(p, "printsBanner")]));
    const when = el("td", { text: queued ? p.promised_date : p.printed_date });
    if (queued && p.waiting_days) when.appendChild(el("div", { class: "muted", text: `waiting ${p.waiting_days} day${p.waiting_days === 1 ? "" : "s"}` }));
    if (!queued) when.appendChild(el("div", { class: "muted", text: `promised ${p.promised_date}` }));
    tr.appendChild(when);

    const actions = el("td", { class: "print-actions" });
    if (queued) {
      const done = el("button", { class: p.position === 1 ? "btn-primary" : "btn-secondary", type: "button", text: "✔ Printed" });
      done.addEventListener("click", () => openPrintedModal(p));
      actions.appendChild(done);
    } else {
      const back = el("button", { class: "btn-secondary", type: "button", title: "Put it back in the queue (marked printed by mistake)", text: "↩ Back to queue" });
      back.addEventListener("click", async () => {
        await api(`/api/prints/${p.id}/unprinted`, { method: "POST" });
        showBanner("printsBanner", `${printTitle(p)} for ${p.name} is back in the queue. ` +
          "Anything already recorded under Rewards given stays there (undo it there if needed).", "success");
        loadPrints();
      });
      actions.appendChild(back);
    }
    const edit = el("button", { class: "btn-icon btn-edit", type: "button", title: "Edit", text: "✎" });
    edit.addEventListener("click", () => openPrintModal(p));
    const del = el("button", { class: "btn-icon", type: "button", title: "Delete", text: "✖" });
    del.addEventListener("click", async () => {
      const ok = await confirmDialog("Delete print", `Delete "${printTitle(p)}" for ${p.name}${p.has_file ? " and its file" : ""}? This can't be undone.`);
      if (!ok) return;
      await api(`/api/prints/${p.id}`, { method: "DELETE" });
      loadPrints();
    });
    actions.append(edit, del);
    tr.appendChild(actions);
    tbody.appendChild(tr);
  });
}

function setPrintsView(view) {
  printsView = view;
  loadPrints();
}
document.getElementById("printsQueuedBtn").addEventListener("click", () => setPrintsView("queued"));
document.getElementById("printsPrintedBtn").addEventListener("click", () => setPrintsView("printed"));
document.getElementById("printsSearch").addEventListener("input", () => loadPrints());
document.getElementById("addPrintBtn").addEventListener("click", () => openPrintModal(null));

// ---- Add / edit window

let printNinjas = [];
function updatePrintNinjaHint() {
  const typed = personKey(document.getElementById("pf_name").value);
  const n = printNinjas.find((x) => personKey(x.name) === typed);
  document.getElementById("pf_owed_hint").textContent = n
    ? `${n.prints_owed} 3D print${n.prints_owed === 1 ? "" : "s"} owed on Rewards owed · ${n.queued} in the queue now` : "";
}
document.getElementById("pf_name").addEventListener("input", updatePrintNinjaHint);

async function openPrintModal(print, ninjaName) {
  editingPrint = print;
  hideBanner("printFormError");
  document.getElementById("printModalTitle").textContent = print ? "Edit 3D print" : "Add a 3D print";
  document.getElementById("printModalSubmit").textContent = print ? "Save" : "Add to queue";
  document.getElementById("printModalSubmit").disabled = false;
  document.getElementById("pf_name").value = print ? print.name : ninjaName || "";
  document.getElementById("pf_description").value = print ? print.description || "" : "";
  document.getElementById("pf_link").value = print ? print.model_link || "" : "";
  document.getElementById("pf_file").value = "";
  document.getElementById("pf_promised").value = print ? print.promised_date : todayInput();
  document.getElementById("pf_printed_field").style.display = print && print.printed_date ? "" : "none";
  document.getElementById("pf_printed").value = print && print.printed_date ? print.printed_date : "";

  const current = document.getElementById("pf_current_file");
  current.innerHTML = "";
  if (print && print.has_file) {
    const remove = el("input", { type: "checkbox", id: "pf_remove_file" });
    current.append(
      el("span", { text: `Saved: ${print.file_name} (${printSizeText(print.file_size || 0)}). Choose another file to replace it, or ` }),
      el("label", {}, [remove, document.createTextNode(" remove it")]));
  }

  document.getElementById("printModalOverlay").classList.add("open");
  try {
    printNinjas = await api("/api/prints/ninjas");
    const list = document.getElementById("printNinjaOptions");
    list.innerHTML = "";
    printNinjas.forEach((n) => list.appendChild(el("option", { value: n.name,
      label: n.prints_owed ? `${n.prints_owed} print${n.prints_owed === 1 ? "" : "s"} owed` : "" })));
    updatePrintNinjaHint();
  } catch (_) { /* the names are only suggestions */ }
  document.getElementById(print || ninjaName ? "pf_description" : "pf_name").focus();
}

function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

function closePrintModal() {
  document.getElementById("printModalOverlay").classList.remove("open");
}
document.getElementById("printModalCancel").addEventListener("click", closePrintModal);

document.getElementById("printModalSubmit").addEventListener("click", async () => {
  const btn = document.getElementById("printModalSubmit");
  const body = {
    name: document.getElementById("pf_name").value.trim(),
    description: document.getElementById("pf_description").value.trim(),
    model_link: document.getElementById("pf_link").value.trim(),
    promised_date: document.getElementById("pf_promised").value,
  };
  if (editingPrint && editingPrint.printed_date) body.printed_date = document.getElementById("pf_printed").value;
  const remove = document.getElementById("pf_remove_file");
  if (remove && remove.checked) body.remove_file = true;
  const file = document.getElementById("pf_file").files[0];
  if (file && file.size > PRINT_FILE_LIMIT) {
    showBanner("printFormError", `That file is ${printSizeText(file.size)}. Files up to 2 MB can be kept here; ` +
      "for a bigger one, put it in Google Drive (or Tinkercad / Thingiverse) and paste the link instead.", "error");
    return;
  }
  btn.disabled = true;
  try {
    if (file) body.file = { name: file.name, type: file.type, data: await readFileBase64(file) };
    if (editingPrint) await api(`/api/prints/${editingPrint.id}`, { method: "PUT", body: JSON.stringify(body) });
    else await api("/api/prints", { method: "POST", body: JSON.stringify(body) });
    closePrintModal();
    if (rewardsPart === "prints") loadPrints();
    if (profileNinja && document.getElementById("ninjaProfileOverlay").classList.contains("open")) openNinjaProfile({ uid: profileNinja.uid });
  } catch (error) {
    showBanner("printFormError", error.message, "error");
    btn.disabled = false;
  }
});

// ---- Mark as printed window. Recording it as a given reward is a separate, visible choice.

function openPrintedModal(print) {
  printedFor = print;
  hideBanner("printedError");
  document.getElementById("printedIntro").textContent = `${printTitle(print)} for ${print.name} (promised ${print.promised_date}).` +
    (print.position > 1 ? ` It is #${print.position} in the queue; marking it printed is fine, the others keep their order.` : "");
  document.getElementById("pd_date").value = todayInput();
  const box = document.getElementById("pd_given");
  box.checked = false;
  document.getElementById("pd_given_field").style.display = print.prints_owed > 0 ? "" : "none";
  document.getElementById("pd_given_label").textContent = `Also record it as handed out: adds 1 × 3D Print to Rewards given ` +
    `(${print.name} has ${print.prints_owed} owed, this makes it ${print.prints_owed - 1})`;
  document.getElementById("printedSubmit").disabled = false;
  document.getElementById("printedModalOverlay").classList.add("open");
}

document.getElementById("printedCancel").addEventListener("click", () => {
  document.getElementById("printedModalOverlay").classList.remove("open");
});

document.getElementById("printedSubmit").addEventListener("click", async () => {
  const btn = document.getElementById("printedSubmit");
  btn.disabled = true;
  try {
    const result = await api(`/api/prints/${printedFor.id}/printed`, { method: "POST", body: JSON.stringify({
      printed_date: document.getElementById("pd_date").value,
      record_given: document.getElementById("pd_given").checked,
    }) });
    document.getElementById("printedModalOverlay").classList.remove("open");
    showBanner("printsBanner", `Marked printed: ${printTitle(printedFor)} for ${printedFor.name}.` +
      (result.recorded_given ? " 1 × 3D Print recorded under Rewards given." : ""), "success");
    if (rewardsPart === "prints") loadPrints();
    if (profileNinja && document.getElementById("ninjaProfileOverlay").classList.contains("open")) openNinjaProfile({ uid: profileNinja.uid });
  } catch (error) {
    showBanner("printedError", error.message, "error");
    btn.disabled = false;
  }
});

// ================================================================
// SETTINGS
// ================================================================

function renderSettingsForm() {
  const container = document.getElementById("settingsFields");
  container.innerHTML = "";

  Object.keys(SETTINGS_LABELS).forEach((key) => {
    const wrap = el("div", { class: "settings-field" });
    wrap.appendChild(el("label", { text: SETTINGS_LABELS[key] }));
    const textarea = el("textarea", { id: "settings_" + key });
    textarea.value = (settings[key] || []).join("\n");
    wrap.appendChild(textarea);
    container.appendChild(wrap);
  });
}

document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
  hideBanner("settingsBanner");

  try {
    for (const key of Object.keys(SETTINGS_LABELS)) {
      const values = document.getElementById("settings_" + key).value
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean);
      await api("/api/settings/" + key, { method: "PUT", body: JSON.stringify({ values }) });
      settings[key] = values;
    }
    showBanner("settingsBanner", "Settings saved.", "success");
  } catch (error) {
    showBanner("settingsBanner", error.message, "error");
  }
});

// ================================================================
// INIT
// ================================================================

async function init() {
  settings = await api("/api/settings");
  renderSettingsForm();
  const current = document.querySelector(".tab-btn.active");
  showPage(current ? current.dataset.group : "ninjas");
}

init();

// Used by the Security tab after the data is replaced (restore / import an old database):
// forget any ticked rows and reload the screens from the new data.
window.ninjaReload = async function () {
  leadsSelected.clear();
  beltsSelected.clear();
  activeSelected.clear();
  await init();
};
