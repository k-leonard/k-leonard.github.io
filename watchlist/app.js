import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEV_MODE = false; // <-- set to false when Supabase is back
console.log("WATCHLIST app.js loaded - DEV_MODE =", DEV_MODE);
 

const SUPABASE_URL = "https://lldpkdwbnlqfuwjbbirt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsZHBrZHdibmxxZnV3amJiaXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NTc3NTcsImV4cCI6MjA4NjQzMzc1N30.OGKn4tElV2k1_ZJKOVjPxBSQUixZB5ywMYo5eGZTDe4";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const el = (id) => document.getElementById(id);

const authMsg = el("authMsg");
const msg = el("msg");
const appSection = el("app");
const logoutBtn = el("logout");
const authCard = el("authCard");

// Cache for client-side filtering
let ALL_SHOWS_CACHE = [];

// --------------------
// UI helpers
// --------------------
function setDisplay(id, show) {
  const node = el(id);
  if (!node) return;
  node.style.display = show ? "" : "none";
}

function showAuthedUI(isAuthed) {
  setDisplay("authCard", !isAuthed);

  const logout = el("logout");
  if (logout) logout.style.display = isAuthed ? "" : "none";

  // Hide all app views if not authed
  if (!isAuthed) {
    ["home", "browse", "collection"].forEach(name => setDisplay(`view-${name}`, false));
    return;
  }

  // Authed: router decides which view shows
  route();
}

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

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
// --------------------
// Hash Router (Home / Browse / Collection)
// --------------------
function route() {
  const raw = (window.location.hash || "#home").slice(1);
  const views = ["home", "browse", "collection"];

  // Normalize bad hashes back to home
  const hash = views.includes(raw) ? raw : "home";

  for (const name of views) {
    setDisplay(`view-${name}`, name === hash);

    const t = el(`tab-${name}`);
    if (t) t.classList.toggle("active", name === hash);
  }
}

function wireTabs() {
  const views = ["home", "browse", "collection"];

  views.forEach(name => {
    const tab = el(`tab-${name}`);
    if (!tab) {
      console.warn("Missing tab element:", `tab-${name}`);
      return;
    }

    tab.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.hash = `#${name}`;
      route();
    });
  });
}

// --------------------
// Browse filter helpers
// --------------------
function fillSelect(selectId, rows, label) {
  const sel = el(selectId);
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML =
    `<option value="">All ${label}</option>` +
    (rows || [])
      .map(r => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`)
      .join("");
  sel.value = current || "";
}

function rowHasName(list, key, wanted) {
  if (!wanted) return true;
  return (list || []).some(x => x?.[key]?.name === wanted);
}

function applyClientFilters(rows) {
  const q = (el("q")?.value || "").trim().toLowerCase();
  const status = el("statusFilter")?.value || "";
  const platform = el("platformFilter")?.value || "";
  const genre = el("genreFilter")?.value || "";
  const trope = el("tropeFilter")?.value || "";
  const studio = (el("studioFilter")?.value || "").trim().toLowerCase();
  const minRating = el("minRatingFilter")?.value ? Number(el("minRatingFilter").value) : null;

  return (rows || []).filter(r => {
    if (q && !String(r.title || "").toLowerCase().includes(q)) return false;
    if (status && r.status !== status) return false;
    if (studio && !String(r.studio || "").toLowerCase().includes(studio)) return false;

    if (minRating != null) {
      const rs = r.rating_stars == null ? 0 : Number(r.rating_stars);
      if (rs < minRating) return false;
    }

    if (platform && !rowHasName(r.show_platforms, "platforms", platform)) return false;
    if (genre && !rowHasName(r.show_genres, "genres", genre)) return false;
    if (trope && !rowHasName(r.show_tropes, "tropes", trope)) return false;

    return true;
  });
}

function rerenderFiltered() {
  renderTable(applyClientFilters(ALL_SHOWS_CACHE));
  msg.textContent = applyClientFilters(ALL_SHOWS_CACHE).length ? "" : "No results.";
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

  // Safety: if the HTML isn't on this page/view yet, don't crash
  if (!btn || !menu || !chips) {
    console.warn(`Missing multiselect elements for ${tableName}`, { buttonId, menuId, chipsId });
    return { setRows: () => {}, getIds: () => [], clear: () => {} };
  }

  const selected = new Map();
  let allRows = [];

  function renderChips() {
    chips.innerHTML = Array.from(selected.values())
      .map(name => `<span class="chip">${escapeHtml(name)}</span>`)
      .join("");
    btn.textContent = selected.size ? `Selected (${selected.size})` : `Select ${tableName}`;
  }

  function renderMenu(filterText = "") {
    const f = filterText.trim().toLowerCase();
    const filtered = f ? allRows.filter(r => r.name.toLowerCase().includes(f)) : allRows;

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

    menu.querySelector(`#${menuId}_search`).addEventListener("input", (e) => {
      renderMenu(e.target.value);
    });

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

function updateHomeCounts() {
  const counts = { 
    "To Be Watched": 0,
    "Watching": 0,
    "Waiting for Next Season": 0,
    "Watched": 0
  };

  for (const r of (ALL_SHOWS_CACHE || [])) {
    if (counts[r.status] != null) counts[r.status] += 1;
  }

  // These IDs must exist in your home view HTML
  const map = [
    ["count-toWatch", counts["To Be Watched"]],
    ["count-watching", counts["Watching"]],
    ["count-waiting", counts["Waiting for Next Season"]],
    ["count-watched", counts["Watched"]],
  ];

  map.forEach(([id, val]) => {
    const node = el(id);
    if (node) node.textContent = String(val);
  });
}


// --------------------
// Clickable Stars for Ratings
// --------------------
function setupStarRating({ containerId, inputId, clearId }) {
  const wrap = el(containerId);
  const hidden = el(inputId);
  const clearBtn = el(clearId);

  const stars = Array.from(wrap.querySelectorAll(".star"));
  let value = 0;

  function paint(n) {
    stars.forEach((btn, i) => {
      btn.textContent = (i < n) ? "★" : "☆";
    });
  }

  function set(n) {
    value = n;
    hidden.value = n ? String(n) : "";
    paint(n);
  }

  stars.forEach((btn) => {
    btn.addEventListener("mouseenter", () => paint(Number(btn.dataset.value)));
    btn.addEventListener("mouseleave", () => paint(value));
    btn.addEventListener("click", () => set(Number(btn.dataset.value)));
  });

  clearBtn.addEventListener("click", () => set(0));
  return { clear: () => set(0) };
}

// --------------------
// DB helpers
// --------------------
async function getOrCreateOptionRow(tableName, name) {
  const cleaned = String(name).trim();
  if (!cleaned) return null;

  const ins = await supabase
    .from(tableName)
    .insert([{ name: cleaned }], { onConflict: "name", ignoreDuplicates: true });

  if (ins.error) console.error(`Insert into ${tableName} failed:`, ins.error);

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
  const rating_stars = parseRatingStars(formData.get("my_rating"));

  let last_watched = null;
  if (status === "Watched") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    last_watched = d.toISOString().slice(0, 10);
  }
  if (status === "To Be Watched") last_watched = null;

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

  let query = supabase
    .from("shows")
    .order("created_at", { ascending: false });

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

  ALL_SHOWS_CACHE = data || [];
  rerenderFiltered();
 updateHomeCounts();
}

// --------------------
// Render
// --------------------
function renderTable(rows) {
   const table = el("table");
  if (!table) return;
  const tbody = table.querySelector("tbody");
  if (!tbody) return;
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
// Init
// --------------------
async function init() {
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

  const starUI = setupStarRating({
    containerId: "ratingStars",
    inputId: "my_rating",
    clearId: "clearRating"
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

    if (DEV_MODE) {
      msg.textContent = "DEV_MODE: not saving to DB.";
      return;
    }

    await addShow(
      new FormData(e.target),
      platformSelect.getIds(),
      genreSelect.getIds(),
      tropeSelect.getIds()
    );

    e.target.reset();
    starUI.clear();
    platformSelect.clear();
    genreSelect.clear();
    tropeSelect.clear();
    await loadShows();
  });

  // Browse controls (new)
  const rerender = debounce(rerenderFiltered, 150);
  ["q","statusFilter","platformFilter","genreFilter","tropeFilter","studioFilter","minRatingFilter"]
    .forEach(id => {
      const node = el(id);
      if (!node) return;
      const evt = (id === "q" || id === "studioFilter") ? "input" : "change";
      node.addEventListener(evt, rerender);
    });

  el("clearFilters")?.addEventListener("click", () => {
    if (el("q")) el("q").value = "";
    if (el("statusFilter")) el("statusFilter").value = "";
    if (el("platformFilter")) el("platformFilter").value = "";
    if (el("genreFilter")) el("genreFilter").value = "";
    if (el("tropeFilter")) el("tropeFilter").value = "";
    if (el("studioFilter")) el("studioFilter").value = "";
    if (el("minRatingFilter")) el("minRatingFilter").value = "";
    rerenderFiltered();
  });

  // Refresh button
  el("refresh").addEventListener("click", () => {
    if (DEV_MODE) rerenderFiltered();
    else loadShows();
  });
  // --------------------
  // Router wiring (MUST run in DEV_MODE too)
  // --------------------
  wireTabs();
  window.addEventListener("hashchange", route);

  if (!window.location.hash) window.location.hash = "#home";

  console.log("Router ready. Current hash =", window.location.hash);
  route();



  // DEV_MODE boot
  if (DEV_MODE) {
    showAuthedUI(true);
    authMsg.textContent = "DEV_MODE: auth disabled (Supabase outage)";
    el("sendLink").disabled = true;

    const devPlatforms = [
      { id: 1, name: "Crunchyroll" },
      { id: 2, name: "Netflix" },
      { id: 3, name: "Hulu" }
    ];
    const devGenres = [
      { id: 1, name: "Romance" },
      { id: 2, name: "Action" },
      { id: 3, name: "Slice of Life" }
    ];
    const devTropes = [
      { id: 1, name: "Enemies to Lovers" },
      { id: 2, name: "Found Family" },
      { id: 3, name: "Time Loop" },
      { id: 4, name: "Slow Burn" }
    ];

    platformSelect.setRows(devPlatforms);
    genreSelect.setRows(devGenres);
    tropeSelect.setRows(devTropes);

    fillSelect("platformFilter", devPlatforms, "platforms");
    fillSelect("genreFilter", devGenres, "genres");
    fillSelect("tropeFilter", devTropes, "tropes");

    ALL_SHOWS_CACHE = [
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
      },
      {
        id: 2,
        title: "365 Days Before the Wedding",
        status: "To Be Watched",
        rating_stars: null,
        studio: "",
        last_watched: null,
        show_platforms: [{ platforms: { name: "Crunchyroll" } }],
        show_genres: [{ genres: { name: "Romance" } }],
        show_tropes: [{ tropes: { name: "Slow Burn" } }]
      }
    ];

    rerenderFiltered();
    return;
  }



// Normal mode: Supabase online
const { data: { session } } = await supabase.auth.getSession();
showAuthedUI(!!session);

if (session) {
  const [p, g, t] = await Promise.all([
    loadOptionRows("platforms"),
    loadOptionRows("genres"),
    loadOptionRows("tropes")
  ]);

  platformSelect.setRows(p);
  genreSelect.setRows(g);
  tropeSelect.setRows(t);

  fillSelect("platformFilter", p, "platforms");
  fillSelect("genreFilter", g, "genres");
  fillSelect("tropeFilter", t, "tropes");

  await loadShows();       // fills ALL_SHOWS_CACHE
  updateHomeCounts();      // (you’ll add this below)
  // optional: renderCollectionCards(); etc
}

supabase.auth.onAuthStateChange(async (_event, session2) => {
  showAuthedUI(!!session2);
  if (authMsg) authMsg.textContent = session2 ? "Logged in." : "Logged out.";

  if (!session2) return;

  const [p, g, t] = await Promise.all([
    loadOptionRows("platforms"),
    loadOptionRows("genres"),
    loadOptionRows("tropes")
  ]);

  platformSelect.setRows(p);
  genreSelect.setRows(g);
  tropeSelect.setRows(t);

  fillSelect("platformFilter", p, "platforms");
  fillSelect("genreFilter", g, "genres");
  fillSelect("tropeFilter", t, "tropes");

  await loadShows();
  updateHomeCounts();
});

}

init();


