import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEV_MODE = false; // <-- set to false when Supabase is back
console.log("WATCHLIST app.js loaded - DEV_MODE =", DEV_MODE);
 

const SUPABASE_URL = "https://lldpkdwbnlqfuwjbbirt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsZHBrZHdibmxxZnV3amJiaXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NTc3NTcsImV4cCI6MjA4NjQzMzc1N30.OGKn4tElV2k1_ZJKOVjPxBSQUixZB5ywMYo5eGZTDe4";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const el = (id) => document.getElementById(id);

const authMsg = el("authMsg");
const browseMsg = el("msg");
const homeMsg = el("homeMsg");

function setMsg(text) {
  if (homeMsg) homeMsg.textContent = text;
  if (browseMsg) browseMsg.textContent = text;
}
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

   setDisplay("app", isAuthed);
  // Hide all app views if not authed
  if (!isAuthed) {
    ["home", "browse", "collection"].forEach(name => setDisplay(`view-${name}`, false));
    return;
  }

  // Authed: router decides which view shows
  route();
}

function toIntOrNull(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toDateOrNull(v) {
  const s = String(v ?? "").trim();
  return s ? s : null; // 'YYYY-MM-DD' from <input type="date">
}
function syncOvaVisibility() {
  const cat = el("category")?.value;
  const isAnime = cat === "Anime";
  const block = el("ovaBlock");
  if (block) block.style.display = isAnime ? "" : "none";

  // If switching away from Anime, clear OVA inputs
  if (!isAnime) {
    const ovas = document.querySelector('input[name="ovas"]');
    const ovaLen = document.querySelector('input[name="ova_length_min"]');
    if (ovas) ovas.value = "";
    if (ovaLen) ovaLen.value = "";
  }
}
function syncProgressVisibility() {
  const status = el("status")?.value || document.querySelector('select[name="status"]')?.value;
  const isWatching = status === "Watching";

  const block = el("progressBlock");
  if (block) block.style.display = isWatching ? "" : "none";

  if (!isWatching) {
    const s = document.querySelector('input[name="current_season"]');
    const e = document.querySelector('input[name="current_episode"]');
    if (s) s.value = "";
    if (e) e.value = "";
  }
}

function syncTypeVisibility() {
  const type = el("show_type")?.value || document.querySelector('select[name="show_type"]')?.value || "";

  const isTV = type === "TV" || type === "TV & Movie";
  const isMovie = type === "Movie" || type === "TV & Movie";

  const tvBlock = el("tvBlock");
  const movieBlock = el("movieBlock");

  if (tvBlock) tvBlock.style.display = isTV ? "" : "none";
  if (movieBlock) movieBlock.style.display = isMovie ? "" : "none";

  // Clear hidden fields so you don’t save stale values
  if (!isTV) {
    document.querySelector('input[name="seasons"]')?.setAttribute("value", "");
    const a = document.querySelector('input[name="seasons"]'); if (a) a.value = "";
    const b = document.querySelector('input[name="episodes"]'); if (b) b.value = "";
    const c = document.querySelector('input[name="episode_length_min"]'); if (c) c.value = "";
  }

  if (!isMovie) {
    const a = document.querySelector('input[name="movies"]'); if (a) a.value = "";
    const b = document.querySelector('input[name="movie_length_min"]'); if (b) b.value = "";
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
// Hash Router (Home / Browse / Collection/ Show Tab)
// --------------------
function route() {
  const raw = (window.location.hash || "#home").slice(1);

  // split "show?id=123" -> name="show", query="id=123"
  const [nameRaw] = raw.split("?");
  const views = ["home", "browse", "collection", "show"];

  const name = views.includes(nameRaw) ? nameRaw : "home";

  views.forEach(v => {
    setDisplay(`view-${v}`, v === name);

    const t = el(`tab-${v}`);
    if (t) t.classList.toggle("active", v === name);
  });

  // If we navigated to show detail, load it
  if (name === "show") {
    const params = new URLSearchParams(raw.split("?")[1] || "");
    const id = params.get("id");
    if (id) loadShowDetail(Number(id));
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

function renderCollectionCards() {
  const wrap = el("collectionList");
  if (!wrap) return;

  if (!ALL_SHOWS_CACHE.length) {
    wrap.textContent = "No shows yet.";
    return;
  }

  // basic sorting options
  const sort = el("collectionSort")?.value || "recent";
  const group = el("collectionGroup")?.value || "";

  let rows = ALL_SHOWS_CACHE.slice();

  if (group) rows = rows.filter(r => r.category === group);

  if (sort === "alpha") {
    rows.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  } else if (sort === "rating") {
    rows.sort((a, b) => (b.rating_stars ?? -1) - (a.rating_stars ?? -1));
  } else {
    // recent (created_at newest first) - if created_at exists
    rows.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  }

  wrap.innerHTML = rows.map(r => {
    const rating = r.rating_stars ? starsDisplay(r.rating_stars) : "";
    const status = r.status || "";
    const type = r.show_type || "";
    const cat = r.category || "";
    return `
      <button class="collectionCard" type="button" data-id="${r.id}">
        <div class="collectionTitle">${escapeHtml(r.title)}</div>
        <div class="collectionMeta muted">${escapeHtml([cat, type, status].filter(Boolean).join(" • "))}</div>
        <div class="collectionMeta">${escapeHtml(rating)}</div>
      </button>
    `;
  }).join("");

  wrap.querySelectorAll(".collectionCard").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      window.location.hash = `#show?id=${id}`;
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

 const searchEl = menu.querySelector(`#${menuId}_search`);

// IMPORTANT: keep the typed value after re-render
searchEl.value = filterText;

// IMPORTANT: keep focus so typing doesn't "die"
searchEl.focus({ preventScroll: true });
searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length);

searchEl.addEventListener("input", (e) => {
  // Re-render using the current typed value
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

function getCollectionRows() {
  const group = el("collectionGroup")?.value || "";
  const sort = el("collectionSort")?.value || "recent";

  // Filter
  let rows = (ALL_SHOWS_CACHE || []).slice();
  if (group) rows = rows.filter(r => r.category === group);

  // Sort
  if (sort === "alpha") {
    rows.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
  } else if (sort === "rating") {
    rows.sort((a, b) => (Number(b.rating_stars || 0) - Number(a.rating_stars || 0)));
  } else {
    // recent = most recently watched, else newest created
    rows.sort((a, b) => {
      const aw = a.last_watched ? Date.parse(a.last_watched) : -Infinity;
      const bw = b.last_watched ? Date.parse(b.last_watched) : -Infinity;
      if (bw !== aw) return bw - aw;

      const ac = a.created_at ? Date.parse(a.created_at) : 0;
      const bc = b.created_at ? Date.parse(b.created_at) : 0;
      return bc - ac;
    });
  }

  return rows;
}

function renderCollection() {
  const wrap = el("collectionList");
  const note = el("collectionMsg");
  if (!wrap) return;

  const rows = getCollectionRows();

  if (!rows.length) {
    wrap.innerHTML = "";
    if (note) note.textContent = "No items yet (try switching filters or add a show).";
    return;
  }

  if (note) note.textContent = "";

  wrap.innerHTML = rows.map(r => {
    const platforms = (r.show_platforms || []).map(x => x.platforms?.name).filter(Boolean);
    const genres = (r.show_genres || []).map(x => x.genres?.name).filter(Boolean);
    const tropes = (r.show_tropes || []).map(x => x.tropes?.name).filter(Boolean);

    const progress =
      r.status === "Watching" && (r.current_season || r.current_episode)
        ? `S${r.current_season || "?"} · E${r.current_episode || "?"}`
        : "";

    return `
      <div class="card" style="margin: 10px 0;">
        <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
          <div>
            <div style="font-weight:700; font-size:16px;">${escapeHtml(r.title)}</div>
            <div class="muted" style="margin-top:4px;">
              ${escapeHtml(r.category || "")}${r.show_type ? " • " + escapeHtml(r.show_type) : ""}
              ${r.ongoing ? " • " + escapeHtml(r.ongoing) : ""}
            </div>
          </div>

          <div style="text-align:right;">
            <div style="font-weight:600;">${escapeHtml(r.status || "")}</div>
            <div class="muted">${escapeHtml(starsDisplay(r.rating_stars))}</div>
            ${progress ? `<div class="muted" style="margin-top:4px;">${escapeHtml(progress)}</div>` : ""}
          </div>
        </div>

        <div class="muted" style="margin-top:10px; display:grid; gap:6px;">
          ${platforms.length ? `<div><b>Where:</b> ${escapeHtml(platforms.join(", "))}</div>` : ""}
          ${genres.length ? `<div><b>Genres:</b> ${escapeHtml(genres.join(", "))}</div>` : ""}
          ${tropes.length ? `<div><b>Tropes:</b> ${escapeHtml(tropes.join(", "))}</div>` : ""}
          ${r.studio ? `<div><b>Studio:</b> ${escapeHtml(r.studio)}</div>` : ""}
          ${r.last_watched ? `<div><b>Last watched:</b> ${escapeHtml(r.last_watched)}</div>` : ""}
        </div>
      </div>
    `;
  }).join("");
}


// --------------------
// Clickable Stars for Ratings
// --------------------
function setupStarRating({ containerId, inputId, clearId }) {
  const wrap = el(containerId);
  const hidden = el(inputId);
  const clearBtn = el(clearId);

  if (!wrap || !hidden || !clearBtn) {
    console.warn("Missing star rating elements", { containerId, inputId, clearId });
    return { clear: () => {} };
  }

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
async function addShow(formData, platformIds, genreIds, tropeIds, studioIds) {
  const user_id = await getUserId();
  if (!user_id) {
    msg.textContent = "You must be logged in.";
    return;
  }

  const title = formData.get("title").trim();
  const status = formData.get("status");
  const studio = String(formData.get("studio") || "").trim() || null;
  const rating_stars = parseRatingStars(formData.get("my_rating"));

  const category = formData.get("category") || "Non-anime";
  const show_type = formData.get("show_type") || null;
  const ongoing = formData.get("ongoing") || null;
  const release_date = toDateOrNull(formData.get("release_date"));

  const seasons = toIntOrNull(formData.get("seasons"));
  const episodes = toIntOrNull(formData.get("episodes"));
  const episode_length_min = toIntOrNull(formData.get("episode_length_min"));
 const current_season = toIntOrNull(formData.get("current_season"));
const current_episode = toIntOrNull(formData.get("current_episode"));

  const movies = toIntOrNull(formData.get("movies"));
  const movie_length_min = toIntOrNull(formData.get("movie_length_min"));

  // Anime-only (store null if not Anime)
  const ovas = (category === "Anime") ? toIntOrNull(formData.get("ovas")) : null;
  const ova_length_min = (category === "Anime") ? toIntOrNull(formData.get("ova_length_min")) : null;

  // status -> last_watched rules
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
      last_watched,

      category,
      show_type,
      ongoing,
      release_date,

      seasons,
      episodes,
      episode_length_min,

      movies,
      movie_length_min,

      ovas,
      ova_length_min,
     current_season,
current_episode
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
 await insertJoinRows({ joinTable: "show_studios", user_id, show_id, fkColumn: "studio_id", ids: studioIds });

  msg.textContent = "Added!";
}

 

async function deleteShow(id) {
  const { error } = await supabase.from("shows").delete().eq("id", id);
  if (error) msg.textContent = `Error: ${error.message}`;
}

async function loadShows() {
  if (DEV_MODE) return;

  msg.textContent = "Loading…";

  const { data, error } = await supabase
    .from("shows")
    .select(`
       id, user_id, title, status, rating_stars, studio, last_watched, created_at,
    category, show_type, ongoing, release_date,
    seasons, episodes, episode_length_min,
    movies, movie_length_min,
    ovas, ova_length_min,
    current_season, current_episode,
    show_platforms(platforms(name)),
    show_genres(genres(name)),
    show_tropes(tropes(name)),
     show_studios(studios(name))
    `)
    .order("created_at", { ascending: false });

  if (error) {
    msg.textContent = `Error: ${error.message}`;
    return;
  }

  ALL_SHOWS_CACHE = data || [];
  rerenderFiltered();
  updateHomeCounts();
 renderCollection();
 renderCollectionCards();
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
   const studios = (r.show_studios || []).map(x => x.studios?.name).filter(Boolean);


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
function labelVal(label, val) {
  const v = (val === null || val === undefined || val === "") ? "—" : String(val);
  return `<div class="factRow"><div class="factLabel muted">${escapeHtml(label)}</div><div class="factValue">${escapeHtml(v)}</div></div>`;
}

function namesFromJoin(list, key) {
  return (list || []).map(x => x?.[key]?.name).filter(Boolean);
}

async function loadShowDetail(showId) {
  const titleEl = el("showTitle");
  const metaEl = el("showMeta");
  const descEl = el("showDescription");
  const factsEl = el("showFacts");
  const tagsEl = el("showTags");
  const notesEl = el("showNotes");
  const msgEl = el("showDetailMsg");

  if (msgEl) msgEl.textContent = "Loading…";

  // NOTE: add/remove fields based on your schema
  const { data, error } = await supabase
    .from("shows")
    .select(`
      id, title, status, rating_stars, last_watched, created_at,
      category, show_type, ongoing, release_date,
      seasons, episodes, episode_length_min,
      movies, movie_length_min,
      ovas, ova_length_min,
      current_season, current_episode,
      notes,
      description,
      show_platforms(platforms(name)),
      show_genres(genres(name)),
      show_tropes(tropes(name)),
      show_studios(studios(name))
    `)
    .eq("id", showId)
    .single();

  if (error) {
    if (msgEl) msgEl.textContent = `Error: ${error.message}`;
    return;
  }

  if (msgEl) msgEl.textContent = "";

  if (titleEl) titleEl.textContent = data.title || "Show";

  const metaBits = [
    data.category,
    data.show_type,
    data.status,
    data.rating_stars ? starsDisplay(data.rating_stars) : null
  ].filter(Boolean);

  if (metaEl) metaEl.textContent = metaBits.join(" • ");

  if (descEl) descEl.textContent = data.description?.trim() || "(No description yet.)";
  if (notesEl) notesEl.textContent = data.notes?.trim() || "(No notes.)";

  const platforms = namesFromJoin(data.show_platforms, "platforms");
  const genres = namesFromJoin(data.show_genres, "genres");
  const tropes = namesFromJoin(data.show_tropes, "tropes");
  const studios = namesFromJoin(data.show_studios, "studios");

  if (factsEl) {
    factsEl.innerHTML = [
      labelVal("Ongoing", data.ongoing),
      labelVal("Release date", data.release_date),
      labelVal("Last watched", data.last_watched),
      labelVal("Current season", data.current_season),
      labelVal("Current episode", data.current_episode),

      // TV info
      labelVal("# Seasons", data.seasons),
      labelVal("# Episodes", data.episodes),
      labelVal("Episode length (min)", data.episode_length_min),

      // Movie info
      labelVal("# Movies", data.movies),
      labelVal("Movie length (min)", data.movie_length_min),

      // Anime extras
      labelVal("# OVAs", data.ovas),
      labelVal("OVA length (min)", data.ova_length_min),
    ].join("");
  }

  if (tagsEl) {
    tagsEl.innerHTML = `
      ${studios.length ? `<div><span class="muted">Studios:</span> ${escapeHtml(studios.join(", "))}</div>` : ""}
      ${platforms.length ? `<div><span class="muted">Platforms:</span> ${escapeHtml(platforms.join(", "))}</div>` : ""}
      ${genres.length ? `<div><span class="muted">Genres:</span> ${escapeHtml(genres.join(", "))}</div>` : ""}
      ${tropes.length ? `<div><span class="muted">Tropes:</span> ${escapeHtml(tropes.join(", "))}</div>` : ""}
      ${(!studios.length && !platforms.length && !genres.length && !tropes.length) ? `<div class="muted">No tags yet.</div>` : ""}
    `;
  }
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
 const studioSelect = setupDbMultiSelect({
  buttonId: "studioBtn",
  menuId: "studioMenu",
  chipsId: "studioChips",
  tableName: "studios"
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
      tropeSelect.getIds(),
      studioSelect.getIds()
    );

  e.target.reset();
starUI.clear();
platformSelect.clear();
genreSelect.clear();
tropeSelect.clear();
   studioSelect.clear();
syncOvaVisibility();
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
// Anime toggle -> show/hide OVA fields
el("category")?.addEventListener("change", syncOvaVisibility);
syncOvaVisibility();
// Status toggle -> show/hide progress fields
document.querySelector('select[name="status"]')?.addEventListener("change", syncProgressVisibility);
syncProgressVisibility();

el("show_type")?.addEventListener("change", syncTypeVisibility);
syncTypeVisibility();

 el("collectionGroup")?.addEventListener("change", renderCollection);
el("collectionSort")?.addEventListener("change", renderCollection);
el("collectionGroup")?.addEventListener("change", renderCollectionCards);
el("collectionSort")?.addEventListener("change", renderCollectionCards);
el("backToCollection")?.addEventListener("click", () => {
  window.location.hash = "#collection";
  route();
});


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
const [p, g, t, s] = await Promise.all([
  loadOptionRows("platforms"),
  loadOptionRows("genres"),
  loadOptionRows("tropes"),
  loadOptionRows("studios")
]);


  platformSelect.setRows(p);
  genreSelect.setRows(g);
  tropeSelect.setRows(t);
studioSelect.setRows(s);
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


