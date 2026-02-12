

const DEV_MODE = true; // <-- set to false when Supabase is back
console.log("WATCHLIST app.js loaded - DEV_MODE =", DEV_MODE);

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://lldpkdwbnlqfuwjbbirt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsZHBrZHdibmxxZnV3amJiaXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NTc3NTcsImV4cCI6MjA4NjQzMzc1N30.OGKn4tElV2k1_ZJKOVjPxBSQUixZB5ywMYo5eGZTDe4";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const el = (id) => document.getElementById(id);

const authMsg = el("authMsg");
const msg = el("msg");
const appSection = el("app");
const listCard = el("listCard");
const logoutBtn = el("logout");

// --------------------
// UI helpers
// --------------------
function showAuthedUI(isAuthed) {
  appSection.style.display = isAuthed ? "" : "none";
  listCard.style.display = isAuthed ? "" : "none";
  logoutBtn.style.display = isAuthed ? "" : "none";
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function starsDisplay(n) {
  if (n == null) return "";
  const full = Math.max(0, Math.min(5, Number(n)));
  return "★★★★★".slice(0, full) + "☆☆☆☆☆".slice(0, 5 - full);
}

function parseRatingStars(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  if (s.includes("★")) return (s.match(/★/g) || []).length;
  const n = Number(s);
  return Number.isFinite(n) ? Math.min(5, Math.max(0, Math.round(n))) : null;
}

// --------------------
// Auth
// --------------------
async function getUserId() {
  const { data } = await supabase.auth.getUser();
  return data.user?.id || null;
}

async function sendMagicLink(email) {
  authMsg.textContent = "Sending magic link…";
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href }
  });
  authMsg.textContent = error
    ? `Error: ${error.message}`
    : "Check your email for the sign-in link.";
}

async function logout() {
  await supabase.auth.signOut();
  authMsg.textContent = "Logged out.";
  showAuthedUI(false);
}

// --------------------
// DB-backed MultiSelect (search + add new)
// --------------------
function setupDbMultiSelect({ buttonId, menuId, chipsId, tableName }) {
  const btn = el(buttonId);
  const menu = el(menuId);
  const chips = el(chipsId);

  const selected = new Map(); // Map<optionId, optionName>
  let allRows = []; // [{id, name}]

  function renderChips() {
    chips.innerHTML = Array.from(selected.values())
      .map(name => `<span class="chip">${escapeHtml(name)}</span>`)
      .join("");
    btn.textContent = selected.size ? `Selected (${selected.size})` : `Select ${tableName}`;
  }

  function renderMenu(filterText = "") {
    const f = filterText.trim().toLowerCase();

    const filtered = f
      ? allRows.filter(r => r.name.toLowerCase().includes(f))
      : allRows;

    const optionsHtml = filtered.map(r => {
      const checked = selected.has(r.id) ? "checked" : "";
      return `
        <label class="option">
          <input type="checkbox" data-id="${r.id}" ${checked} />
          <span>${escapeHtml(r.name)}</span>
        </label>
      `;
    }).join("");

    const exactMatch = f && allRows.some(r => r.name.toLowerCase() === f);
    const addHtml = (!exactMatch && f)
      ? `<button type="button" class="secondary" id="${menuId}_addBtn">+ Add "${escapeHtml(filterText.trim())}"</button>`
      : "";

    menu.innerHTML = `
      <input class="search" id="${menuId}_search" placeholder="Search…" />
      ${addHtml}
      <div id="${menuId}_options">${optionsHtml}</div>
    `;

    // Search listener
    menu.querySelector(`#${menuId}_search`).addEventListener("input", (e) => {
      renderMenu(e.target.value);
    });

    // Add listener
    const addBtn = menu.querySelector(`#${menuId}_addBtn`);
    if (addBtn) {
      addBtn.addEventListener("click", async () => {
        const name = filterText.trim();
        if (!name) return;
        const row = await getOrCreateOptionRow(tableName, name);
        if (row) {
          if (!allRows.some(r => r.id === row.id)) {
            allRows.push(row);
            allRows.sort((a, b) => a.name.localeCompare(b.name));
          }
          selected.set(row.id, row.name);
          renderChips();
          renderMenu("");
        }
      });
    }

    // Checkbox listeners
    menu.querySelectorAll('input[type="checkbox"][data-id]').forEach(cb => {
      cb.addEventListener("change", () => {
        const id = Number(cb.dataset.id);
        const row = allRows.find(r => r.id === id);
        if (!row) return;

        if (cb.checked) selected.set(row.id, row.name);
        else selected.delete(row.id);

        renderChips();
      });
    });
  }

  btn.addEventListener("click", () => {
    menu.classList.toggle("hidden");
    if (!menu.classList.contains("hidden")) renderMenu("");
  });

  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target) && e.target !== btn) {
      menu.classList.add("hidden");
    }
  });

  return {
    setRows: (rows) => {
      allRows = (rows || []).slice().sort((a, b) => a.name.localeCompare(b.name));
      renderChips();
    },
    getIds: () => Array.from(selected.keys()),
    clear: () => {
      selected.clear();
      renderChips();
    }
  };
}

async function getOrCreateOptionRow(tableName, name) {
  const cleaned = String(name).trim();
  if (!cleaned) return null;

  // Insert if missing (unique(name) + ignore duplicates)
  const ins = await supabase
    .from(tableName)
    .insert([{ name: cleaned }], { onConflict: "name", ignoreDuplicates: true });

  if (ins.error) {
    console.error(`Insert into ${tableName} failed:`, ins.error);
    // still try to select
  }

  const sel = await supabase
    .from(tableName)
    .select("id,name")
    .eq("name", cleaned)
    .maybeSingle();

  if (sel.error) {
    console.error(`Select from ${tableName} failed:`, sel.error);
    return null;
  }
  return sel.data || null;
}

async function loadOptionRows(tableName) {
  const r = await supabase.from(tableName).select("id,name").order("name");
  if (r.error) {
    console.error(`${tableName} load error:`, r.error);
    return [];
  }
  return r.data || [];
}

async function insertJoinRows({ joinTable, user_id, show_id, fkColumn, ids }) {
  if (!ids || !ids.length) return;

  const rows = ids.map(id => ({
    user_id,
    show_id,
    [fkColumn]: id
  }));

  const r = await supabase.from(joinTable).insert(rows);
  if (r.error) console.error(`${joinTable} insert error:`, r.error);
}

// --------------------
// CRUD
// --------------------
async function addShow(formData, platformIds, genreIds, tropeIds) {
  const user_id = await getUserId();
  if (!user_id) {
    msg.textContent = "You must be logged in.";
    return;
  }

  const title = formData.get("title").trim();
  const status = formData.get("status");
  const studio = String(formData.get("studio") || "").trim() || null;

  // rating: accept ★★★★☆ or a number (stored 0-5)
  const rating_stars = parseRatingStars(formData.get("my_rating"));

  // status -> last_watched rules
  let last_watched = null;
  if (status === "Watched") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    last_watched = d.toISOString().slice(0, 10);
  }
  if (status === "To Be Watched") last_watched = null;

  // Insert show + get show_id
  const ins = await supabase
    .from("shows")
    .insert([{
      user_id,
      title,
      status,
      rating_stars,
      studio,
      last_watched
    }])
    .select("id")
    .single();

  if (ins.error) {
    msg.textContent = `Error: ${ins.error.message}`;
    return;
  }

  const show_id = ins.data.id;

  // Insert joins
  await insertJoinRows({ joinTable: "show_platforms", user_id, show_id, fkColumn: "platform_id", ids: platformIds });
  await insertJoinRows({ joinTable: "show_genres", user_id, show_id, fkColumn: "genre_id", ids: genreIds });
  await insertJoinRows({ joinTable: "show_tropes", user_id, show_id, fkColumn: "trope_id", ids: tropeIds });

  msg.textContent = "Added!";
}

async function deleteShow(id) {
  const { error } = await supabase.from("shows").delete().eq("id", id);
  if (error) msg.textContent = `Error: ${error.message}`;
}

async function loadShows() {
  if (DEV_MODE) return;
  msg.textContent = "Loading…";
  const q = el("q").value.trim();
  const status = el("statusFilter").value;

  let query = supabase
    .from("shows")
    .order("created_at", { ascending: false });

  if (q) query = query.ilike("title", `%${q}%`);
  if (status) query = query.eq("status", status);

  // Select show fields + joined option names
  const { data, error } = await query.select(`
    id, user_id, title, status, rating_stars, studio, last_watched, created_at,
    show_platforms(platforms(name)),
    show_genres(genres(name)),
    show_tropes(tropes(name))
  `);

  if (error) {
    msg.textContent = `Error: ${error.message}`;
    return;
  }

  renderTable(data || []);
  msg.textContent = (data && data.length) ? "" : "No results.";
}

function renderTable(rows) {
  const tbody = el("table").querySelector("tbody");
  tbody.innerHTML = "";

  for (const r of rows) {
    const platforms = (r.show_platforms || []).map(x => x.platforms?.name).filter(Boolean);
    const genres = (r.show_genres || []).map(x => x.genres?.name).filter(Boolean);
    const tropes = (r.show_tropes || []).map(x => x.tropes?.name).filter(Boolean);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.title)}</td>
      <td>${escapeHtml(r.status)}</td>
      <td>${escapeHtml(starsDisplay(r.rating_stars))}</td>
      <td>${escapeHtml(platforms.join(", "))}</td>
      <td>${escapeHtml(genres.join(", "))}</td>
      <td>${escapeHtml(tropes.join(", "))}</td>
      <td>${escapeHtml(r.studio ?? "")}</td>
      <td>${r.last_watched ?? ""}</td>
      <td><button data-id="${r.id}" class="danger">Delete</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("button[data-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      await deleteShow(id);
      await loadShows();
    });
  });
}

// --------------------
// Init / wiring
// --------------------
function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function init() {
  // Create selects (requires HTML elements to exist)
  const platformSelect = setupDbMultiSelect({
    buttonId: "platformBtn",
    menuId: "platformMenu",
    chipsId: "platformChips",
    tableName: "platforms"
  });

  const genreSelect = setupDbMultiSelect({
    buttonId: "genreBtn",
    menuId: "genreMenu",
    chipsId: "genreChips",
    tableName: "genres"
  });

  const tropeSelect = setupDbMultiSelect({
    buttonId: "tropeBtn",
    menuId: "tropeMenu",
    chipsId: "tropeChips",
    tableName: "tropes"
  });

  // Login button
  el("sendLink").addEventListener("click", () => {
    const email = el("email").value.trim();
    if (!email) return;
    sendMagicLink(email);
  });

  logoutBtn.addEventListener("click", logout);

  // Add form
  el("addForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await addShow(
      new FormData(e.target),
      platformSelect.getIds(),
      genreSelect.getIds(),
      tropeSelect.getIds()
    );
    e.target.reset();
    platformSelect.clear();
    genreSelect.clear();
    tropeSelect.clear();
    await loadShows();
  });

  // Browse controls
  el("refresh").addEventListener("click", loadShows);
  el("q").addEventListener("input", debounce(loadShows, 250));
  el("statusFilter").addEventListener("change", loadShows);

  // Auth state
 if (DEV_MODE) {
  showAuthedUI(true);

  // Fake sample data for UI work
  platformSelect.setRows([
    { id: 1, name: "Crunchyroll" },
    { id: 2, name: "Netflix" },
    { id: 3, name: "Hulu" }
  ]);

  genreSelect.setRows([
    { id: 1, name: "Romance" },
    { id: 2, name: "Action" },
    { id: 3, name: "Slice of Life" }
  ]);

  tropeSelect.setRows([
    { id: 1, name: "Enemies to Lovers" },
    { id: 2, name: "Found Family" },
    { id: 3, name: "Time Loop" }
  ]);

  renderTable([
    {
      id: 1,
      title: "7th Time Loop",
      status: "Watching",
      rating_stars: 4,
      studio: "Studio A",
      last_watched: "2026-02-11",
      show_platforms: [{ platforms: { name: "Crunchyroll" } }],
      show_genres: [{ genres: { name: "Romance" } }],
      show_tropes: [{ tropes: { name: "Time Loop" } }]
    }
  ]);

  return;
}


if (!DEV_MODE) {
  supabase.auth.onAuthStateChange(async (_event, session2) => {
    showAuthedUI(!!session2);
    authMsg.textContent = session2 ? "Logged in." : "Logged out.";

    if (session2) {
      platformSelect.setRows(await loadOptionRows("platforms"));
      genreSelect.setRows(await loadOptionRows("genres"));
      tropeSelect.setRows(await loadOptionRows("tropes"));
      await loadShows();
    }
  });
}
init();


