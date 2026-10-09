// ================================================================
// STATE
// ================================================================

let settings = {};
let leadsSelected = new Set();
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
  } catch (error) {
    showBanner(bannerId, error.message, "error");
  }
}

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

function renderActiveSchedule(rows) {
  const container = document.getElementById("activeSchedule");
  container.innerHTML = "";

  const knownDays = settings.schedule_days || [];
  const sessionsByName = {};
  rows.forEach((r) => {
    const key = r.name.trim().toLowerCase();
    (sessionsByName[key] = sessionsByName[key] || []).push(r);
  });
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

        // Instructors first, then alphabetical.
        bySlot[slot]
          .sort((a, b) => (b.is_ai - a.is_ai) || a.name.localeCompare(b.name))
          .forEach((row) => {
            const chip = el("div", { class: "ninja-chip" + (row.is_ai ? " ai" : "") });
            const label = el("span", { class: "chip-name", text: row.name });
            chip.appendChild(label);
            if (row.is_ai) chip.appendChild(el("span", { class: "ai-badge", text: "AI" }));

            const mine = sessionsByName[row.name.trim().toLowerCase()] || [];
            if (mine.length > 1) {
              const summary = mine
                .slice()
                .sort((a, b) => dayIndex(a.day) - dayIndex(b.day) || timeSlotSortKey(a.time_slot) - timeSlotSortKey(b.time_slot))
                .map((r) => `${r.day || "No day"} ${r.time_slot || ""}${r.is_ai ? " (AI)" : ""}`.trim())
                .join("\n");
              chip.appendChild(el("span", {
                class: "multi-badge",
                title: `${row.name} has ${mine.length} sessions:\n${summary}`,
                text: "\u00d7" + mine.length,
              }));
            }

            const actions = el("span", { class: "chip-actions" });
            const editBtn = el("button", { class: "btn-icon btn-edit", title: "Edit / move", text: "\u270e" });
            editBtn.addEventListener("click", () => openActiveModal(row));
            const delBtn = el("button", { class: "btn-icon", title: "Remove", text: "\u2716" });
            delBtn.addEventListener("click", async () => {
              const ok = await confirmDialog("Remove Entry", `Remove "${row.name}" from the active roster?`);
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

async function loadActiveNinjas() {
  const search = document.getElementById("activeSearch").value;
  const rows = await api("/api/active-ninjas?q=" + encodeURIComponent(search));
  activeRowsCache = rows;
  const tbody = document.querySelector("#activeTable tbody");
  tbody.innerHTML = "";

  document.getElementById("activeEmpty").style.display = rows.length ? "none" : "block";
  document.getElementById("activeCountLabel").textContent =
    rows.length ? `${rows.length} Ninja${rows.length === 1 ? "" : "s"} shown` : "";

  renderActiveSchedule(rows);
  setActiveView(activeView);

  const visibleIds = new Set(rows.map((r) => r.id));
  activeSelected = new Set([...activeSelected].filter((id) => visibleIds.has(id)));

  rows.forEach((row) => {
    const tr = el("tr");
    if (row.is_ai) tr.classList.add("ai-row");

    const checkbox = el("input", { type: "checkbox" });
    checkbox.checked = activeSelected.has(row.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) activeSelected.add(row.id);
      else activeSelected.delete(row.id);
      updateActiveSelectionUI();
    });
    tr.appendChild(el("td", {}, [checkbox]));

    const nameCell = el("td");
    nameCell.appendChild(document.createTextNode(row.name));
    if (row.is_ai) nameCell.appendChild(el("span", { class: "ai-badge", text: "AI" }));
    tr.appendChild(nameCell);

    tr.appendChild(el("td", { text: row.day || "" }));
    tr.appendChild(el("td", { text: row.time_slot || "" }));
    tr.appendChild(el("td", { text: row.is_ai ? "Yes" : "" }));

    const actionsCell = el("td", { class: "actions-cell" });

    const editBtn = el("button", { class: "btn-icon btn-edit", title: "Edit / change time", text: "\u270e" });
    editBtn.addEventListener("click", () => openActiveModal(row));
    actionsCell.appendChild(editBtn);

    const delBtn = el("button", { class: "btn-icon", title: "Remove", text: "\u2716" });
    delBtn.addEventListener("click", async () => {
      const ok = await confirmDialog("Remove Entry", `Remove "${row.name}" from the active roster?`);
      if (!ok) return;
      await api(`/api/active-ninjas/${row.id}`, { method: "DELETE" });
      loadActiveNinjas();
    });
    actionsCell.appendChild(delBtn);

    tr.appendChild(actionsCell);
    tbody.appendChild(tr);
  });

  document.getElementById("activeSelectAll").checked =
    rows.length > 0 && rows.every((r) => activeSelected.has(r.id));

  updateActiveSelectionUI();
}

document.getElementById("viewScheduleBtn").addEventListener("click", () => setActiveView("schedule"));
document.getElementById("viewListBtn").addEventListener("click", () => setActiveView("list"));

function updateActiveSelectionUI() {
  const count = activeSelected.size;
  document.getElementById("activeSelectionCount").textContent =
    count > 0 ? `${count} selected` : "";
  document.getElementById("deleteSelectedActiveBtn").style.display =
    count > 0 ? "inline-block" : "none";
}

document.getElementById("activeSearch").addEventListener("input", () => loadActiveNinjas());

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
    `Permanently remove ${count} selected Ninja${count === 1 ? "" : "s"} from the active roster? This cannot be undone.`
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

    const aiBox = el("input", { type: "checkbox", title: "Assistant Instructor for this session" });
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

    sessionRows = all
      .map((r) => ({ id: r.id, day: r.day || "", time_slot: r.time_slot || "", is_ai: !!r.is_ai }))
      .sort((a, b) => dayIndex(a.day) - dayIndex(b.day) ||
                      timeSlotSortKey(a.time_slot) - timeSlotSortKey(b.time_slot));
  } else {
    editingOriginalName = null;
    document.getElementById("activeModalTitle").textContent = "Add Ninja";
    document.getElementById("af_name").value = "";
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

async function loadLeads() {
  const search = document.getElementById("leadsSearch").value;
  const rows = await api("/api/leads?q=" + encodeURIComponent(search));
  const tbody = document.querySelector("#leadsTable tbody");
  tbody.innerHTML = "";

  document.getElementById("leadsEmpty").style.display = rows.length ? "none" : "block";

  // Drop selections for rows no longer visible/existing.
  const visibleIds = new Set(rows.map((r) => r.id));
  leadsSelected = new Set([...leadsSelected].filter((id) => visibleIds.has(id)));

  rows.forEach((row) => {
    const tr = el("tr");

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
    ].forEach((value) => tr.appendChild(el("td", { text: value || "" })));

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
    let message = `${result.successCount} ${result.successCount === 1 ? "entry" : "entries"} imported.`;
    if (result.errors.length) message += "\n\n" + result.errors.join("\n");
    showBanner("leadsImportBanner", message, result.successCount > 0 ? "success" : "error");
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
      await api("/api/leads", { method: "POST", body: JSON.stringify(data) });
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
    let message = `${result.successCount} ${result.successCount === 1 ? "entry" : "entries"} added.`;
    if (result.errors.length) message += "\n\n" + result.errors.join("\n");
    showBanner("bulkLeadBanner", message, result.successCount > 0 ? "success" : "error");
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

    const editBtn = el("button", { class: "btn-icon btn-edit", title: "Edit", text: "\u270e" });
    editBtn.addEventListener("click", () => openBeltModal(row));

    const delBtn = el("button", { class: "btn-icon", title: "Remove", text: "\u2716" });
    delBtn.addEventListener("click", async () => {
      const ok = await confirmDialog("Remove Entry", `Remove this entry for "${row.name}"?`);
      if (!ok) return;
      await api(`/api/belts/${row.id}`, { method: "DELETE" });
      loadBelts();
    });
    tr.appendChild(el("td", { class: "actions-cell" }, [editBtn, delBtn]));

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
    card.appendChild(el("div", { class: "totals-card-sub", text: `${data.given} given / ${data.earned} earned` }));
    totalsContainer.appendChild(card);
  });

  const tbody = document.querySelector("#rewardsTable tbody");
  tbody.innerHTML = "";
  document.getElementById("rewardsEmpty").style.display = summary.rows.length ? "none" : "block";

  rewardsRowsCache = summary.rows;

  summary.rows.forEach((row) => {
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
  const rows = await api("/api/rewards/history");
  const tbody = document.querySelector("#historyTable tbody");
  tbody.innerHTML = "";

  document.getElementById("historyEmpty").style.display = rows.length ? "none" : "block";

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

document.getElementById("refreshHistoryBtn").addEventListener("click", loadHistory);

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
