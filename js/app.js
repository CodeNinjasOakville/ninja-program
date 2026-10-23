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
  return window.ninjaApi(method, path, body);
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
  document.getElementById("tagBeltsModalOverlay").classList.add("open");
}

document.getElementById("tagBeltsClose").addEventListener("click", () => {
  document.getElementById("tagBeltsModalOverlay").classList.remove("open");
});

// ================================================================
// TABS
// ================================================================

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");

    if (btn.dataset.tab === "rewards") loadRewards();
    if (btn.dataset.tab === "history") loadHistory();
    if (btn.dataset.tab === "active") loadActiveNinjas();
  });
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

        // Artificial Intelligence sessions first, then alphabetical.
        bySlot[slot]
          .sort((a, b) => (b.is_ai - a.is_ai) || a.name.localeCompare(b.name))
          .forEach((row) => {
            const key = personKey(row.name);
            const chip = el("div", { class: "ninja-chip" + (row.is_ai ? " ai" : ""), "data-person": key });
            const label = el("span", { class: "chip-name" });
            label.appendChild(el("span", { text: row.name }));
            if (row.is_ai) label.appendChild(el("span", { class: "ai-badge", text: "AI" }));

            // Spell out the Ninja's other classes right on the chip.
            const others = (sessionsByName[key] || []).filter((r) => r.id !== row.id);
            if (others.length) {
              label.appendChild(el("span", {
                class: "chip-also",
                text: "Also: " + others.map((r) => sessionLabel(r) + (r.is_ai ? " (AI)" : "")).join(", "),
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

// ---- Belts shared with the Belts tab (rules in js/lib/belt_match.js) ----

let beltQuestions = [];         // Belts-tab names that match more than one Active Ninja
let beltQuestionsShown = false; // the chooser opens by itself once; after "Later" only the banner shows

// Fills blank Active Ninja belts from the Belts tab and asks about names that could be several Ninjas.
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
    `${beltQuestions.length} name${beltQuestions.length === 1 ? "" : "s"} in the Belts tab match more than one Ninja here. ` +
    "Choose who each belt belongs to.";
  if (result.filled.length) {
    showBanner(
      "activeImportBanner",
      "Belts filled in from the Belts tab: " + result.filled.map((f) => `${f.name} (${f.belt})`).join(", "),
      "success"
    );
  }
  if (beltQuestions.length && !beltQuestionsShown) openBeltMatchModal();
}

function openBeltMatchModal() {
  beltQuestionsShown = true;
  hideBanner("beltMatchError");
  const list = document.getElementById("beltMatchList");
  list.innerHTML = "";
  beltQuestions.forEach((q, i) => {
    list.appendChild(el("div", { class: "review-head", text: `"${q.belt_name}" - ${q.belt} belt in the Belts tab` }));
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

    tr.appendChild(el("td", { class: "person-name", text: person.name }));
    const belt = (person.sessions.find((r) => r.belt) || {}).belt;
    tr.appendChild(belt ? el("td", { text: belt }) : el("td", { class: "belt-unknown", text: "\u2014" }));
    tr.appendChild(el("td", { class: "class-count", text: String(person.sessions.length) }));

    const sessionsCell = el("td", { class: "sessions-cell" });
    person.sessions.forEach((r) => {
      const pill = el("span", { class: "session-pill" + (r.is_ai ? " ai" : ""), text: sessionLabel(r) });
      if (r.is_ai) pill.appendChild(el("span", { class: "ai-badge", text: "AI" }));
      sessionsCell.appendChild(pill);
    });
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
    "Last check - this deletes everything in the Active Ninjas table. Continue?"
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
    let message = `${result.successCount} ${result.successCount === 1 ? "entry" : "entries"} imported.`;
    if (result.errors.length) message += "\n\n" + result.errors.join("\n");
    showBanner("activeImportBanner", message, result.successCount > 0 ? "success" : "error");
    if (result.successCount > 0) loadActiveNinjas();
  } catch (error) {
    showBanner("activeImportBanner", error.message, "error");
  } finally {
    e.target.value = "";
  }
});

// ---- Review window for a MyStudio "All classes schedule" export ----
// Nothing is added until "Add Selected" is pressed, and Ninjas already on the roster are never touched.

let rosterReviewPeople = [];   // [{name, similar_to, sessions, checkbox}]

function rosterReviewRow(person, checked) {
  const checkbox = el("input", { type: "checkbox" });
  checkbox.checked = checked;
  checkbox.addEventListener("change", updateRosterReviewUI);
  person.checkbox = checkbox;

  const name = el("span", { class: "person-name", text: person.name });
  if (person.similar_to) {
    name.appendChild(el("span", { class: "muted review-similar", text: `already here as "${person.similar_to}"?` }));
  }
  const sessions = el("span", { class: "sessions-cell" });
  person.sessions.forEach((r) => {
    const pill = el("span", { class: "session-pill" + (r.is_ai ? " ai" : ""), text: sessionLabel(r) });
    if (r.is_ai) pill.appendChild(el("span", { class: "ai-badge", text: "AI" }));
    sessions.appendChild(pill);
  });
  return el("label", { class: "review-row" }, [checkbox, name, sessions]);
}

function updateRosterReviewUI() {
  const picked = rosterReviewPeople.filter((p) => p.checkbox.checked).length;
  const fresh = rosterReviewPeople.filter((p) => !p.similar_to);
  document.getElementById("rosterSelectAll").checked = fresh.length > 0 && fresh.every((p) => p.checkbox.checked);
  const btn = document.getElementById("rosterSubmit");
  btn.textContent = picked ? `Add ${picked} Ninja${picked === 1 ? "" : "s"}` : "Add Selected";
  btn.disabled = picked === 0;
}

function openRosterReview(result) {
  hideBanner("rosterError");
  rosterReviewPeople = result.people;
  const fresh = result.people.filter((p) => !p.similar_to);
  const similar = result.people.filter((p) => p.similar_to);
  const existing = result.alreadyThere;

  if (!result.people.length) {
    showBanner(
      "activeImportBanner",
      `Nothing to add - all ${existing.length} Ninja${existing.length === 1 ? "" : "s"} in that file are already on the roster.`,
      "success"
    );
    return;
  }

  document.getElementById("rosterSummary").textContent =
    "Only Ninjas who are not on the roster yet can be added. Existing entries are left exactly as they are.";

  const newList = document.getElementById("rosterNewList");
  newList.innerHTML = "";
  fresh.forEach((p) => newList.appendChild(rosterReviewRow(p, true)));
  document.getElementById("rosterNewTitle").textContent = `New Ninjas (${fresh.length})`;
  document.getElementById("rosterNewSection").style.display = fresh.length ? "block" : "none";

  const similarList = document.getElementById("rosterSimilarList");
  similarList.innerHTML = "";
  similar.forEach((p) => similarList.appendChild(rosterReviewRow(p, false)));
  document.getElementById("rosterSimilarTitle").textContent = `Possibly already here (${similar.length})`;
  document.getElementById("rosterSimilarSection").style.display = similar.length ? "block" : "none";

  document.getElementById("rosterExistingTitle").textContent =
    `Already on the roster - skipped (${existing.length})`;
  document.getElementById("rosterExistingList").textContent = existing.join(", ");
  document.getElementById("rosterExistingSection").style.display = existing.length ? "block" : "none";

  updateRosterReviewUI();
  document.getElementById("rosterModalOverlay").classList.add("open");
}

document.getElementById("rosterSelectAll").addEventListener("change", (e) => {
  rosterReviewPeople.filter((p) => !p.similar_to).forEach((p) => { p.checkbox.checked = e.target.checked; });
  updateRosterReviewUI();
});

document.getElementById("rosterCancel").addEventListener("click", () => {
  document.getElementById("rosterModalOverlay").classList.remove("open");
});

document.getElementById("rosterSubmit").addEventListener("click", async () => {
  const people = rosterReviewPeople
    .filter((p) => p.checkbox.checked)
    .map((p) => ({ name: p.name, sessions: p.sessions }));
  const btn = document.getElementById("rosterSubmit");
  btn.disabled = true;

  try {
    const result = await api("/api/active-ninjas/import/confirm", { method: "POST", body: JSON.stringify({ people }) });
    let message = `${result.addedNinjas} Ninja${result.addedNinjas === 1 ? "" : "s"} added ` +
      `(${result.addedSessions} class${result.addedSessions === 1 ? "" : "es"}).`;
    if (result.skipped.length) message += `\n\nAlready on the roster, left untouched: ${result.skipped.join(", ")}`;
    document.getElementById("rosterModalOverlay").classList.remove("open");
    showBanner("activeImportBanner", message, result.addedNinjas > 0 ? "success" : "error");
    loadActiveNinjas();
  } catch (error) {
    showBanner("rosterError", error.message, "error");
    btn.disabled = false;
  }
});

// ---- Add / Edit modal: one Ninja, any number of sessions ----

let sessionRows = [];   // [{id?, day, time_slot, is_ai}] being edited
let editingOriginalName = null;

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

    const removeBtn = el("button", { class: "btn-icon", type: "button", title: "Remove this session", text: "\u2716" });
    removeBtn.addEventListener("click", () => {
      sessionRows.splice(index, 1);
      if (sessionRows.length === 0) sessionRows.push({ day: "", time_slot: "", is_ai: false });
      renderSessionRows();
    });

    [daySelect, timeInput, aiCell, removeBtn].forEach((node) => line.appendChild(node));
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
function fillBeltSelect(current) {
  const select = document.getElementById("af_belt");
  select.innerHTML = "";
  const belts = (settings.belt_options || []).map((b) => formatBeltName(String(b).trim())).filter(Boolean);
  if (current && !belts.some((b) => b.toLowerCase() === current.toLowerCase())) belts.push(current);
  select.appendChild(el("option", { value: "", text: "Not set (use the Belts tab)" }));
  belts.forEach((b) => select.appendChild(el("option", { value: b, text: b })));
  select.value = belts.find((b) => b.toLowerCase() === current.toLowerCase()) || "";
}

async function openActiveModal(row) {
  hideBanner("activeFormError");
  refreshTimeSlotSuggestions();

  if (row) {
    editingOriginalName = row.name;
    document.getElementById("activeModalTitle").textContent = "Edit Ninja";
    document.getElementById("af_name").value = row.name;

    // Load every session this Ninja has (not just the row that was clicked).
    let all = [];
    try {
      all = await api("/api/active-ninjas/person?name=" + encodeURIComponent(row.name));
    } catch (error) {
      all = [row];
    }
    if (all.length === 0) all = [row];
    fillBeltSelect((all.find((r) => r.belt) || {}).belt || "");

    sessionRows = all
      .map((r) => ({ id: r.id, day: r.day || "", time_slot: r.time_slot || "", is_ai: !!r.is_ai }))
      .sort((a, b) => dayIndex(a.day) - dayIndex(b.day) ||
                      timeSlotSortKey(a.time_slot) - timeSlotSortKey(b.time_slot));
  } else {
    editingOriginalName = null;
    document.getElementById("activeModalTitle").textContent = "Add Ninja";
    document.getElementById("af_name").value = "";
    fillBeltSelect("");
    sessionRows = [{ day: "", time_slot: "", is_ai: false }];
  }

  renderSessionRows();
  document.getElementById("activeModalOverlay").classList.add("open");
}

document.getElementById("addActiveBtn").addEventListener("click", () => openActiveModal(null));

document.getElementById("addSessionBtn").addEventListener("click", () => {
  // Start the new row from the previous one: same day is the common case
  // (regular hour then AI hour), and it saves retyping.
  const last = sessionRows[sessionRows.length - 1] || { day: "", time_slot: "" };
  sessionRows.push({ day: last.day, time_slot: "", is_ai: false });
  renderSessionRows();
  const inputs = document.querySelectorAll("#af_sessions .session-row input[type=text]");
  if (inputs.length) inputs[inputs.length - 1].focus();
});

document.getElementById("activeModalCancel").addEventListener("click", () => {
  document.getElementById("activeModalOverlay").classList.remove("open");
});

document.getElementById("activeModalSubmit").addEventListener("click", async () => {
  const payload = {
    original_name: editingOriginalName,
    name: document.getElementById("af_name").value,
    belt: document.getElementById("af_belt").value,
    sessions: sessionRows
      .filter((s) => s.id || s.day || (s.time_slot || "").trim() || s.is_ai)
      .map((s) => ({ id: s.id, day: s.day, time_slot: s.time_slot, is_ai: s.is_ai })),
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
    let message = `${result.successCount} ${result.successCount === 1 ? "entry" : "entries"} added.`;
    if (result.errors.length) message += "\n\n" + result.errors.join("\n");
    showBanner("bulkActiveBanner", message, result.successCount > 0 ? "success" : "error");
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

async function loadLeads() {
  const search = document.getElementById("leadsSearch").value;
  const allRows = await api("/api/leads");
  let rows = search.trim() ? await api("/api/leads?q=" + encodeURIComponent(search)) : allRows;
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

  rows.forEach((row) => {
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

// Duplicates (same phone or email as a lead already in the list) are skipped by the import;
// list them so staff can check them by hand.
function showLeadImportResult(bannerId, result, verb) {
  const duplicates = result.duplicates || [];
  let message = `${result.successCount} ${result.successCount === 1 ? "entry" : "entries"} ${verb}.`;
  if (duplicates.length) {
    message += `\n\n${duplicates.length} possible duplicate${duplicates.length === 1 ? " was" : "s were"} skipped:\n` +
      duplicates.join("\n");
  }
  if (result.errors.length) message += "\n\n" + result.errors.join("\n");
  const type = duplicates.length ? "warning" : result.successCount > 0 ? "success" : "error";
  showBanner(bannerId, message, type);
}

document.getElementById("importLeadsBtn").addEventListener("click", () => {
  document.getElementById("importLeadsFile").click();
});

document.getElementById("importLeadsFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  hideBanner("leadsImportBanner");

  try {
    const result = await apiUpload("/api/leads/import", file);
    showLeadImportResult("leadsImportBanner", result, "imported");
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
    showLeadImportResult("bulkLeadBanner", result, "added");
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

    [row.name, row.old_belt, row.new_belt, (row.created_at || "").slice(0, 10)]
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
    "Last check - this deletes everything in the Belts table. Continue?"
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
    let message = `${result.successCount} ${result.successCount === 1 ? "entry" : "entries"} imported.`;
    if (result.errors.length) message += "\n\n" + result.errors.join("\n");
    showBanner("beltsImportBanner", message, result.successCount > 0 ? "success" : "error");
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
      await api("/api/belts", { method: "POST", body: JSON.stringify(data) });
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

async function openBeltCertModal(row) {
  hideBanner("beltsImportBanner");
  let outstanding;
  try {
    outstanding = await api("/api/certificates/outstanding");
  } catch (error) {
    showBanner("beltsImportBanner", error.message, "error");
    return;
  }
  const owed = new Set(outstanding
    .filter((item) => personKey(item.name) === personKey(row.name))
    .map((item) => item.belt));

  beltCertRow = row;
  document.getElementById("beltCertModalTitle").textContent = `Print Certificates - ${row.name}`;
  const container = document.getElementById("beltCertOptions");
  container.innerHTML = "";
  certificateBeltsForEntry(row).forEach((belt) => {
    const checkbox = el("input", { type: "checkbox", value: belt });
    checkbox.checked = owed.has(belt);
    const text = owed.has(belt) ? `${belt} Belt` : `${belt} Belt (already printed)`;
    container.appendChild(el("label", {}, [checkbox, el("span", { text })]));
  });
  hideBanner("beltCertError");
  document.getElementById("beltCertModalOverlay").classList.add("open");
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
    showBanner("beltsImportBanner", `Generated ${result.count} certificate(s) for ${beltCertRow.name}. Downloading...`, "success");
    openDownload(result);
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
    let message = `${result.successCount} ${result.successCount === 1 ? "entry" : "entries"} added.`;
    if (result.errors.length) message += "\n\n" + result.errors.join("\n");
    showBanner("bulkBeltBanner", message, result.successCount > 0 ? "success" : "error");
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
    tr.appendChild(el("td", { text: row.name }));
    tr.appendChild(el("td", { text: row.progression }));
    REWARD_COLUMNS.forEach(([key]) => {
      tr.appendChild(el("td", { text: String(row[key]) }));
    });

    const actionsCell = el("td");
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

document.getElementById("giveRewardsBtn").addEventListener("click", () => {
  document.getElementById("gr_names").value = "";
  ["gr_ninja_bucks", "gr_large_coins", "gr_small_coins", "gr_prints", "gr_certificates", "gr_belts"]
    .forEach((id) => { document.getElementById(id).value = "0"; });
  hideBanner("giveRewardsError");
  document.getElementById("giveRewardsModalOverlay").classList.add("open");
});

document.getElementById("giveRewardsCancel").addEventListener("click", () => {
  document.getElementById("giveRewardsModalOverlay").classList.remove("open");
});

document.getElementById("giveRewardsSubmit").addEventListener("click", async () => {
  const names = document.getElementById("gr_names").value
    .split(",").map((n) => n.trim()).filter(Boolean);

  const payload = { names };
  ["ninja_bucks", "large_coins", "small_coins", "prints", "certificates", "belts"].forEach((field) => {
    payload[field] = Number(document.getElementById("gr_" + field).value || 0);
  });

  const btn = document.getElementById("giveRewardsSubmit");
  btn.disabled = true;

  try {
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
    [row.date, row.name, row.reward_type, row.amount, row.details, row.entry_type]
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
  loadLeads();
  loadBelts();
}

init();

// Used by the Security tab after the data is replaced (restore / import an old database):
// forget any ticked rows and reload the screens from the new data.
window.ninjaReload = async function () {
  leadsSelected.clear();
  beltsSelected.clear();
  activeSelected.clear();
  await init();
  if (document.getElementById("tab-active").classList.contains("active")) loadActiveNinjas();
};
