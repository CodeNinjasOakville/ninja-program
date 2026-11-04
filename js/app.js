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

const PAGE_PANELS = { ninjas: ["active"], rewards: ["rewards", "belts", "history"], leads: ["leads"], settings: ["settings", "security"] };
let rewardsPart = "rewards"; // which part of Belts & Rewards is showing

function loadPanel(panel) {
  // Leads and Belts change when the roster does (enrolled badges, renamed Ninjas), so they reload too.
  if (panel === "leads") loadLeads();
  if (panel === "belts") loadBelts();
  if (panel === "rewards") loadRewards();
  if (panel === "history") loadHistory();
  if (panel === "active") loadActiveNinjas();
}

function showPanels(panels) {
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", panels.includes(p.id.replace("tab-", ""))));
  panels.forEach(loadPanel);
}

function showPage(page) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.group === page));
  document.getElementById("rewardsSubtabs").style.display = page === "rewards" ? "flex" : "none";
  showPanels(page === "rewards" ? [rewardsPart] : PAGE_PANELS[page]);
}

function showRewardsPart(part) {
  rewardsPart = part;
  document.querySelectorAll(".subtab-btn").forEach((b) => b.classList.toggle("active", b.dataset.panel === part));
  showPage("rewards");
}

document.querySelectorAll(".tab-btn").forEach((btn) => btn.addEventListener("click", () => showPage(btn.dataset.group)));
document.querySelectorAll(".subtab-btn").forEach((btn) => btn.addEventListener("click", () => showRewardsPart(btn.dataset.panel)));

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
        if (n) owed.push(el("div", { class: "profile-line" }, [el("b", { text: String(n) }), document.createTextNode(" " + (n === 1 ? one : many))]));
      });
  } else {
    owed.push(el("div", { class: "muted", text: ninja.levels ? "All caught up." : "No belt-ups yet." }));
  }
  body.appendChild(profileCard("Rewards owed", owed));

  const given = ninja.given.slice(0, 8).map((r) => el("div", { class: "profile-line",
    text: `${shortDate(r.date)}  ${r.amount} × ${r.reward_type}` + (r.details ? ` (${r.details})` : "") }));
  if (ninja.given.length > 8) given.push(el("div", { class: "muted", text: `and ${ninja.given.length - 8} more (Belts & Rewards → Rewards given)` }));
  body.appendChild(profileCard("Rewards given", given));

  if (ninja.notes.length || ninja.classes.some((c) => c.is_jr)) {
    const notes = ninja.notes.slice(0, 3).map((n) => el("div", { class: "profile-line",
      text: `${shortDate(n.created_at)}  ${n.note}` + (n.author ? ` — ${n.author}` : "") }));
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

const JR_NOTES_SHOWN = 3;
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

// One JR Ninja: belt, classes, a box to add a note, then the notes (latest few, or all).
function jrCard(person, refresh) {
  const key = jrKey(person.name);
  const card = el("div", { class: "jr-card", "data-person": key });

  const head = el("div", { class: "jr-card-head" });
  head.appendChild(el("span", { class: "person-name", text: person.name }));
  head.appendChild(el("span", { class: "jr-belt" + (person.belt ? "" : " belt-unknown"), text: person.belt ? `${person.belt} belt` : "No belt yet" }));
  card.appendChild(head);
  const sessions = el("div", { class: "sessions-cell" });
  sortSessions(person.sessions).forEach((r) => sessions.appendChild(sessionPill(r)));
  card.appendChild(sessions);

  const draft = el("textarea", {
    class: "jr-draft jr-new", rows: "2", "data-draft": "1",
    placeholder: "What are they working on? (Ctrl+Enter to save)",
  });
  const author = el("input", { type: "text", class: "jr-author", placeholder: "Your name", title: "Who wrote this note" });
  author.value = jrAuthor();
  const addBtn = el("button", { class: "btn-primary", type: "button", text: "Add note" });
  const error = el("div", { class: "banner" });
  addBtn.addEventListener("click", async () => {
    const note = draft.value.trim();
    if (!note) { draft.focus(); return; }
    addBtn.disabled = true;
    try {
      await api("/api/jr-notes", { method: "POST", body: JSON.stringify({ name: person.name, note, author: author.value.trim() }) });
      rememberJrAuthor(author.value.trim());
      draft.value = "";
      await refresh();
    } catch (e) {
      inlineError(error, e.message);
      addBtn.disabled = false;
    }
  });
  draft.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) addBtn.click();
  });
  card.appendChild(el("div", { class: "jr-add" }, [draft, el("div", { class: "jr-add-row" }, [author, addBtn]), error]));

  const list = el("div", { class: "jr-notes" });
  if (!person.notes.length) list.appendChild(el("div", { class: "muted", text: "No notes yet." }));
  const shown = jrExpanded.has(key) ? person.notes : person.notes.slice(0, JR_NOTES_SHOWN);
  shown.forEach((n, i) => list.appendChild(jrNoteItem(n, i === 0, refresh)));
  if (person.notes.length > JR_NOTES_SHOWN) {
    const more = el("button", {
      class: "link-btn", type: "button",
      text: jrExpanded.has(key) ? "Show only the latest" : `Show all ${person.notes.length} notes`,
    });
    more.addEventListener("click", async () => {
      if (jrExpanded.has(key)) jrExpanded.delete(key); else jrExpanded.add(key);
      await refresh();
    });
    list.appendChild(more);
  }
  card.appendChild(list);
  return card;
}

// Unsent "add note" text survives a redraw.
function keepJrDrafts(container, draw) {
  const drafts = {};
  container.querySelectorAll(".jr-card").forEach((card) => {
    const box = card.querySelector("textarea.jr-new");
    if (box && box.value) drafts[card.dataset.person] = box.value;
  });
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
  const search = jrKey(document.getElementById("activeSearch").value);
  const shown = !search || search === "jr" ? people : people.filter((p) =>
    jrKey(p.name).includes(search) || p.sessions.some((s) => jrKey(`${s.day} ${s.time_slot}`).includes(search)));

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
    const notes = people.reduce((n, p) => n + p.notes.length, 0);
    container.appendChild(el("div", {
      class: "jr-summary muted",
      text: `${people.length} JR Ninja${people.length === 1 ? "" : "s"}` +
        (shown.length !== people.length ? ` (${shown.length} match the search)` : "") +
        ` · ${notes} note${notes === 1 ? "" : "s"}. Notes are shared with every sensei.`,
    }));
    shown.forEach((p) => container.appendChild(jrCard(p, loadJrView)));
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
      body.appendChild(jrCard(person, draw));
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

  if (leadsDuplicatesOnly) {
    // Only the duplicates, with each matching group listed together.
    const groupKey = (r) => (isDupPhone(r) ? "p" + leadPhoneKey(r.phone_number) : "e" + leadEmailKey(r.email));
    rows = rows
      .filter(isDuplicate)
      .sort((a, b) => groupKey(a).localeCompare(groupKey(b)) || a.entry_number - b.entry_number);
  }

  document.getElementById("leadsEmpty").style.display = rows.length ? "none" : "block";
  document.getElementById("leadsEmpty").textContent = leadsDuplicatesOnly
    ? "No duplicates match this search."
    : search.trim() ? "No leads match this search." : "No leads yet.";

  // Drop selections for rows no longer visible/existing.
  const visibleIds = new Set(rows.map((r) => r.id));
  leadsSelected = new Set([...leadsSelected].filter((id) => visibleIds.has(id)));

  // Old saved copies of the leads code ignore ?sort=gbs: show the list as-is and offer the update.
  const sortedByGbs = allRows.every((r) => r.gbs_group);
  if (!sortedByGbs) offerLatestVersion("the leads list couldn't be sorted by GBS date");
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

// Every belt a Ninja has completed (and so has a certificate for), across all their belt entries,
// plus their name as written on the Belt-ups list (what goes on the certificate).
async function completedBeltsForNinja(name) {
  const entries = (await api("/api/belts"))
    .filter((row) => personKey(row.name) === personKey(name))
    .reverse(); // oldest first
  const belts = [];
  entries.forEach((row) => certificateBeltsForEntry(row).forEach((belt) => {
    if (!belts.includes(belt)) belts.push(belt);
  }));
  const order = (settings.belt_options || []).map((b) => formatBeltName(normalizeBelt(b)));
  belts.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return { name: entries.length ? entries[0].name.trim() : name, belts };
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
    showBanner(beltCertRow.bannerId, `Generated ${result.count} certificate(s) for ${beltCertRow.name}. Downloading...`, "success");
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
  ["large_coins_remaining", "large_coins"],
  ["small_coins_remaining", "small_coins"],
  ["prints_remaining", "prints"],
  ["certificates_remaining", "certificates"],
  ["belts_remaining", "belts"],
];

const OVERALL_LABELS = {
  ninja_bucks: "Ninja Bucks",
  large_coins: "Large Coins ($10)",
  small_coins: "Small Coins ($1)",
  prints: "3D Prints",
  certificates: "Certificates",
  belts: "New Belts",
};

async function loadRewards() {
  hideBanner("rewardsBanner");
  const summary = await api("/api/rewards/summary");

  const totalsContainer = document.getElementById("rewardsTotals");
  totalsContainer.innerHTML = "";

  const levelsCard = el("div", { class: "totals-card" });
  levelsCard.appendChild(el("div", { class: "totals-card-label", text: "Levels Progressed" }));
  levelsCard.appendChild(el("div", { class: "totals-card-value", text: String(summary.overall.levels_progressed) }));
  totalsContainer.appendChild(levelsCard);

  Object.keys(OVERALL_LABELS).forEach((field) => {
    const data = summary.overall[field];
    const card = el("div", { class: "totals-card" });
    card.appendChild(el("div", { class: "totals-card-label", text: OVERALL_LABELS[field] }));
    card.appendChild(el("div", { class: "totals-card-value", text: String(data.remaining) }));
    // Coins are just how the owed Ninja Bucks get paid, so given/earned doesn't apply to them.
    const isCoin = field === "large_coins" || field === "small_coins";
    const sub = isCoin ? "to pay Ninja Bucks owed" : `${data.given} given / ${data.earned} earned`;
    card.appendChild(el("div", { class: "totals-card-sub", text: sub }));
    totalsContainer.appendChild(card);
  });

  const tbody = document.querySelector("#rewardsTable tbody");
  tbody.innerHTML = "";

  const search = document.getElementById("rewardsSearch").value;
  const rows = summary.rows.filter((row) =>
    matchesSearch([row.name, row.progression, ...REWARD_COLUMNS.map(([key]) => row[key])], search));
  const empty = document.getElementById("rewardsEmpty");
  empty.style.display = rows.length ? "none" : "block";
  empty.textContent = summary.rows.length ? "No rewards match this search." : "Everyone is all caught up - nothing outstanding.";

  rewardsRowsCache = rows;

  rows.forEach((row) => {
    const tr = el("tr");
    tr.appendChild(el("td", {}, [ninjaLink(row.name)]));
    tr.appendChild(el("td", { text: row.progression }));
    REWARD_COLUMNS.forEach(([key]) => {
      tr.appendChild(el("td", { text: String(row[key]) }));
    });

    const actionsCell = el("td");
    const giveBtn = el("button", { class: "btn-icon", title: `Give rewards to ${row.name}`, text: "🎁" });
    giveBtn.addEventListener("click", () => openGiveRewards(row.name, row));
    actionsCell.appendChild(giveBtn);
    if (row.certificates_remaining > 0) {
      const certBtn = el("button", { class: "btn-icon", title: "Generate certificate(s)", text: "\ud83c\udf93" });
      certBtn.addEventListener("click", () => generateCertificateForRow(row));
      actionsCell.appendChild(certBtn);
    }
    tr.appendChild(actionsCell);

    tbody.appendChild(tr);
  });
}

document.getElementById("refreshRewardsBtn").addEventListener("click", loadRewards);
document.getElementById("rewardsSearch").addEventListener("input", () => loadRewards());

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

    showBanner("rewardsBanner", `Generated ${result.count} certificate(s) for ${row.name}. Downloading...`, "success");
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
    showBanner("rewardsBanner", `Generated ${result.count} certificate(s). Downloading...`, "success");
    openDownload(result);
    loadRewards();
  } catch (error) {
    showBanner("rewardsBanner", error.message, "error");
  }
});

// ---- Give Rewards modal ----

const GIVE_FIELDS = ["ninja_bucks", "large_coins", "small_coins", "prints", "certificates", "belts"];

// name/row are set when opened from a Ninja's row: the name is filled in and what they are
// still owed is shown under each box.
function openGiveRewards(name, row) {
  document.getElementById("gr_names").value = name || "";
  GIVE_FIELDS.forEach((field) => {
    document.getElementById("gr_" + field).value = "0";
    document.getElementById("gr_owed_" + field).textContent = row ? `${row[field + "_remaining"]} owed` : "";
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
    // More certificates than one Ninja is owed: they are reprinting (e.g. a lost certificate),
    // so record the other rewards and let the person pick which certificates to print.
    if (names.length === 1 && Number.isInteger(payload.certificates) && payload.certificates > 0) {
      const summary = await api("/api/rewards/summary");
      const owedRow = summary.rows.find((r) => personKey(r.name) === personKey(names[0]));
      const owed = owedRow ? owedRow.certificates_remaining : 0;
      if (payload.certificates > owed) {
        await giveWithCertificatePicker(names[0], payload, owed);
        return;
      }
    }
    await api("/api/rewards/give", { method: "POST", body: JSON.stringify(payload) });
    document.getElementById("giveRewardsModalOverlay").classList.remove("open");
    loadRewards();
  } catch (error) {
    showBanner("giveRewardsError", error.message, "error");
  } finally {
    btn.disabled = false;
  }
});

async function giveWithCertificatePicker(typedName, payload, owed) {
  const { name, belts } = await completedBeltsForNinja(typedName);
  if (!belts.length) {
    throw new Error(`${typedName} has not completed any belts yet, so there are no certificates to print.`);
  }

  const others = { ...payload, names: [name], certificates: 0 };
  const hasOthers = GIVE_FIELDS.some((field) => others[field] !== 0);
  if (hasOthers) await api("/api/rewards/give", { method: "POST", body: JSON.stringify(others) });

  document.getElementById("giveRewardsModalOverlay").classList.remove("open");
  await loadRewards();

  const owedText = owed === 1 ? "only 1 is owed" : `only ${owed} are owed`;
  await openCertPicker(name, belts, {
    bannerId: "rewardsBanner",
    intro: `You entered ${payload.certificates} certificates but ${owedText}. ` +
      "Tick the ones to print - certificates already printed can be printed again." +
      (hasOthers ? " The other rewards have been recorded." : ""),
    onDone: loadRewards,
  });
}

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
    "Remove every Certificate transaction from Reward History? All certificates will show as owed again. This cannot be undone."
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
