console.count("app.js executed");

// =========================
// DEBUG KIT
// =========================
const DEBUG = true;

function d(...args) {
  if (!DEBUG) return;
  console.log("%c[DBG]", "color:#8e44ad;font-weight:700;", ...args);
}
function w(...args) {
  if (!DEBUG) return;
  console.warn("%c[DBG WARN]", "color:#d35400;font-weight:700;", ...args);
}
function e(...args) {
  if (!DEBUG) return;
  console.error("%c[DBG ERR]", "color:#c0392b;font-weight:700;", ...args);
}

// Catch silent failures
window.addEventListener("error", (ev) => {
  e("window.error:", ev.message, ev.filename, ev.lineno, ev.colno, ev.error);
});
window.addEventListener("unhandledrejection", (ev) => {
  e("unhandledrejection:", ev.reason);
});

// Quick DOM snapshot helper
function snap(label = "snap") {
  if (!DEBUG) return;
  const ids = [
    "app",
    "authCard","loginForm","logout",
    "view-home","view-browse","view-collection","view-show",
    "openAddShowBtn","addShowModal","closeAddShowBtn",
    "table","collectionList","collectionGrid"
  ];
  const state = {};
  for (const id of ids) {
    const n = document.getElementById(id);
    state[id] = n
      ? { exists:true, display:getComputedStyle(n).display, hidden:n.classList?.contains("hidden") }
      : { exists:false };
  }
  d(label, {
    hash: window.location.hash,
    readyState: document.readyState,
    state
  });
}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEV_MODE = false; // allows me to still work on aspects if supabase is down
console.log("WATCHLIST app.js loaded - DEV_MODE =", DEV_MODE);

// -------------------
// Constants
// -------------------
const SUPABASE_URL = "https://lldpkdwbnlqfuwjbbirt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsZHBrZHdibmxxZnV3amJiaXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NTc3NTcsImV4cCI6MjA4NjQzMzc1N30.OGKn4tElV2k1_ZJKOVjPxBSQUixZB5ywMYo5eGZTDe4";
const supabase = window.__SUPABASE__ || createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
    storageKey: "watchlist-auth",
  },
});
window.__SUPABASE__ = supabase;
window.supabase = supabase;
d("Supabase client created");
supabase.auth.getSession().then(({ data, error }) => {
  d("getSession (early probe)", { hasSession: !!data?.session, error });
});

const TMDB_API_KEY = "0c4eb2a53f1a768d02688b02187a7996"; // <-- add your key
const TMDB_IMG_BASE = "https://image.tmdb.org/t/p/w500"; // common base for posters
// DEBUG: auth storage probe
setTimeout(() => {
  try {
    const k = "watchlist-auth";
    d("auth storage probe", {
      hasKey: localStorage.getItem(k) != null,
      keyLen: (localStorage.getItem(k) || "").length
    });
  } catch (err) {
    w("auth storage probe failed", err);
  }
}, 500);
let CURRENT_SHOW = null;
// --------------------
// AUTH STATE (authoritative)
// --------------------
let CURRENT_SESSION = null;
let CURRENT_USER_ID = null;

async function restoreSessionOnLoad() {
  const { data, error } = await supabase.auth.getSession();
  if (error) w("restoreSessionOnLoad getSession error:", error);

  CURRENT_SESSION = data?.session ?? null;
  CURRENT_USER_ID = CURRENT_SESSION?.user?.id ?? null;

  d("restoreSessionOnLoad()", { hasSession: !!CURRENT_SESSION, userId: CURRENT_USER_ID });
  return CURRENT_SESSION;
}
let EDIT_MODE = false;
const el = (id) => document.getElementById(id);

const msg = el("msg");        // browse/main msg
const authMsg = el("authMsg");
const browseMsg = el("msg");
const homeMsg = el("homeMsg");

let PLATFORM_ROWS = null;
let GENRE_ROWS = null;
let TROPE_ROWS = null;
let STUDIO_ROWS = null;
let EDIT_GENRE_SELECT = null;
let EDIT_TROPE_SELECT = null;
let EDIT_STUDIO_SELECT = null;
const STATUS_ITEMS = [
  "To Be Watched",
  "Watching",
  "Waiting for Next Season",
  "Watched",
  "Dropped"
];

const CATEGORY_ITEMS = [
  "Anime",
  "Western Animation",
  "Live-Action Series",
  "Reality / Competition",
  "Documentary",
  "Movies",
  "Animated Movies"
];

const SHOW_TYPE_ITEMS = [
  "TV",
  "Movie",
  "TV & Movie"
];
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
async function appendJoinRows({ joinTable, user_id, show_id, fkColumn, ids }) {
  const cleanIds = (ids || []).map(Number).filter(Boolean);
  if (!cleanIds.length) return;

  // fetch existing ids for this show
  const { data: existing, error: selErr } = await supabase
    .from(joinTable)
    .select(fkColumn)
    .eq("user_id", user_id)
    .eq("show_id", show_id);

  if (selErr) throw selErr;

  const existingSet = new Set((existing || []).map(r => r[fkColumn]).filter(Boolean));
  const toInsert = cleanIds.filter(id => !existingSet.has(id));
  if (!toInsert.length) return;

  const rows = toInsert.map(id => ({
    user_id,
    show_id,
    [fkColumn]: id
  }));

  const { error: insErr } = await supabase.from(joinTable).insert(rows);
  if (insErr) throw insErr;
}
async function getExistingJoinIds({ joinTable, user_id, show_id, fkColumn }) {
  const { data, error } = await supabase
    .from(joinTable)
    .select(fkColumn)
    .eq("user_id", user_id)
    .eq("show_id", show_id);

  if (error) throw error;
  return new Set((data || []).map(r => r[fkColumn]).filter(Boolean));
}

async function appendJoinRowsByNames({ tableName, joinTable, user_id, show_id, fkColumn, names }) {
  const cleanNames = (names || [])
    .map(x => String(x || "").trim())
    .filter(Boolean);

  if (!cleanNames.length) return;

  // 1) Convert names -> ids (create if missing)
  const rows = [];
  for (const name of cleanNames) {
    const row = await getOrCreateOptionRow(tableName, name); // you already have this
    if (row?.id) rows.push(row);
  }
  if (!rows.length) return;

  // 2) Only insert missing ids (append behavior)
  const existing = await getExistingJoinIds({ joinTable, user_id, show_id, fkColumn });

  const toInsert = rows
    .map(r => r.id)
    .filter(id => !existing.has(id));

  if (!toInsert.length) return;

  await insertJoinRows({ joinTable, user_id, show_id, fkColumn, ids: toInsert });
}



function setupRailPager(rowEl, prevBtn, nextBtn, pageSize = 5) {
  if (!rowEl || !prevBtn || !nextBtn) return;

  let page = 0;

  function getStepPx() {
    const firstCard = rowEl.querySelector(".media-card");
    if (!firstCard) return 0;

    const cardW = firstCard.getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(rowEl).gap || "0") || 0;

    return (cardW + gap) * pageSize;
  }

  function maxPage() {
    const count = rowEl.querySelectorAll(".media-card").length;
    return Math.max(0, Math.ceil(count / pageSize) - 1);
  }

  function render() {
    const step = getStepPx();
    const maxP = maxPage();

    if (page > maxP) page = maxP;
    if (page < 0) page = 0;

    rowEl.style.transform = `translateX(${-page * step}px)`;
    prevBtn.disabled = page === 0;
    nextBtn.disabled = page === maxP;
  }

  prevBtn.addEventListener("click", () => { page--; render(); });
  nextBtn.addEventListener("click", () => { page++; render(); });

  // Recompute sizes on resize so paging stays aligned
  window.addEventListener("resize", render);

  // Public refresh method (call after you re-render the rail)
  return { refresh: render, reset: () => { page = 0; render(); } };
}

async function loadHomeRails() {
  const railRecentAdded   = document.getElementById("rail_recent_added");
  const railCurrentlyWatching = document.getElementById("rail_currently_watching");
  const railRandom        = document.getElementById("rail_random");
  const shuffleBtn        = document.getElementById("rail_shuffle");

  const addedPrev  = document.getElementById("recent_added_prev");
  const addedNext  = document.getElementById("recent_added_next");
  const randomPrev = document.getElementById("random_prev");
  const randomNext = document.getElementById("random_next");

  // Bail early if rails aren’t on this page
   if (!railRecentAdded || !railCurrentlyWatching || !railRandom) return;

// helper to render a row (your defensive version)
  function renderRail(container, rows) {
    container.innerHTML = "";

    for (const show of (rows || [])) {
      const card = createShowCardForRail(show);

      // If your card builder returns HTML as a STRING, support that too:
      if (typeof card === "string") {
        const wrap = document.createElement("div");
        wrap.innerHTML = card.trim();
        if (wrap.firstElementChild) container.appendChild(wrap.firstElementChild);
        continue;
      }

      // Normal case: must be a DOM Node
      if (card instanceof Node) {
        container.appendChild(card);
        continue;
      }

      // Debug: see what it is
      console.warn("createShowCardForRail did not return a Node:", card, "for show:", show);
    }
  }

  // Set up pagers (safe even if buttons missing; setupRailPager returns null/undefined)
  const addedPager  = setupRailPager(railRecentAdded, addedPrev, addedNext, 5);
  const randomPager = setupRailPager(railRandom, randomPrev, randomNext, 5);

  // 1) Recently Added
  const { data: recentAdded, error: err1 } = await supabase
    .from("shows")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(25); // pull more than 12 so paging feels real

  if (!err1 && recentAdded) {
    renderRail(railRecentAdded, recentAdded);
    if (addedPager) addedPager.reset(); // go back to page 0 + update button states
  }

 // 2) Currently Watching
let watching = [];
let err2 = null;

{
  const { data, error } = await supabase
    .from("shows")
    .select("*")
    .eq("status", "Watching")
    .order("created_at", { ascending: false })
    .limit(25);

  watching = data || [];
  err2 = error || null;
}

if (err2) {
  console.warn("Currently Watching load error:", err2);
}

renderRail(railCurrentlyWatching, watching);

  // 3) Random Picks
  async function loadRandomPicks() {
    const { data, error } = await supabase
      .from("shows")
      .select("*")
      .limit(200);

    if (error || !data) return;

    // shuffle (Fisher–Yates)
    for (let i = data.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [data[i], data[j]] = [data[j], data[i]];
    }

    // render enough to page through (5 at a time)
    renderRail(railRandom, data.slice(0, 30));
    if (randomPager) randomPager.reset();
  }

  await loadRandomPicks();

  if (shuffleBtn) {
    shuffleBtn.addEventListener("click", loadRandomPicks);
  }
}

 
async function fetchShowFromTMDb(query) {
  if (!TMDB_API_KEY) throw new Error("Missing TMDB_API_KEY");
  console.log("[FETCH NON-ANIME] clicked", {
  id: CURRENT_SHOW?.id,
  title: CURRENT_SHOW?.title,
  category: CURRENT_SHOW?.category,
  show_type: CURRENT_SHOW?.show_type
});
  // "multi" search returns movie + tv results
  const searchUrl =
    `https://api.themoviedb.org/3/search/multi?api_key=${encodeURIComponent(TMDB_API_KEY)}` +
    `&query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`;

  const sres = await fetch(searchUrl);
  if (!sres.ok) throw new Error(`TMDb search error: ${sres.status}`);
  const sjson = await sres.json();

  const results = (sjson && sjson.results) ? sjson.results : [];
  const best = results.find(r => r && (r.media_type === "tv" || r.media_type === "movie"));
  if (!best) return null;

  const mediaType = best.media_type; // "tv" | "movie"
  const id = best.id;

  const detailsUrl =
    `https://api.themoviedb.org/3/${mediaType}/${id}?api_key=${encodeURIComponent(TMDB_API_KEY)}` +
    `&language=en-US`;

  const dres = await fetch(detailsUrl);
  if (!dres.ok) throw new Error(`TMDb details error: ${dres.status}`);
  const d = await dres.json();

  const canonical_title =
    (mediaType === "tv" ? d.name : d.title) ||
    (mediaType === "tv" ? best.name : best.title) ||
    null;

  const release_date =
    (mediaType === "tv" ? d.first_air_date : d.release_date) ||
    (mediaType === "tv" ? best.first_air_date : best.release_date) ||
    null;

  const poster_path = d.poster_path || best.poster_path || null;
  const image_url = poster_path ? `${TMDB_IMG_BASE}${poster_path}` : null;

  const genres = Array.isArray(d.genres) ? d.genres.map(g => g?.name).filter(Boolean) : [];

  // closest equivalents to "studio"
  const studios =
    Array.isArray(d.production_companies) ? d.production_companies.map(c => c?.name).filter(Boolean) : [];

  // If you want “network” as studio-like for TV:
  const networks =
    Array.isArray(d.networks) ? d.networks.map(n => n?.name).filter(Boolean) : [];

  const studio_like = [...new Set([...(studios || []), ...(networks || [])])];
  const description = (d?.overview || "").trim() || null;
  return {
    tmdb_id: id,
    media_type: mediaType,
    canonical_title,
    release_date,
    image_url,
    genres,
    studios: studio_like,
    description
  };
}
function withTimeoutAbort(makePromise, ms, label = "timeout") {
  const controller = new AbortController();
  let t;

  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} after ${ms}ms`));
    }, ms);
  });

  // makePromise MUST use controller.signal (via .abortSignal or fetch signal)
  return Promise.race([makePromise(controller.signal), timeout])
    .finally(() => clearTimeout(t));
}

function clearSupabaseLocalAuthTokens() {
  // Supabase stores tokens in localStorage keys like: sb-<project-ref>-auth-token
  const keys = Object.keys(localStorage);
  const removed = [];

  for (const k of keys) {
      if (k.startsWith("sb-lldpkdwbnlqfuwjbbirt-")) {
      removed.push(k);
      localStorage.removeItem(k);
    }
  }

  d("clearSupabaseLocalAuthTokens removed:", removed);
  return removed;
}
async function refreshBrowseFilterOptions() {
  await ensureOptionRowsLoaded();

  // Re-fetch in case a new option was added
  PLATFORM_ROWS = await loadOptionRows("platforms");
  GENRE_ROWS    = await loadOptionRows("genres");
  TROPE_ROWS    = await loadOptionRows("tropes");
  STUDIO_ROWS   = await loadOptionRows("studios");

  buildCheckboxList({
    boxId: "platformFilterBox",
    items: (PLATFORM_ROWS || []).map(r => r.name),
    name: "platformFilter",
    searchInputId: "platformFilterSearch",
    onChange: rerenderFiltered
  });

  buildCheckboxList({
    boxId: "genreFilterBox",
    items: (GENRE_ROWS || []).map(r => r.name),
    name: "genreFilter",
    searchInputId: "genreFilterSearch",
    onChange: rerenderFiltered
  });

  buildCheckboxList({
    boxId: "tropeFilterBox",
    items: (TROPE_ROWS || []).map(r => r.name),
    name: "tropeFilter",
    searchInputId: "tropeFilterSearch",
    onChange: rerenderFiltered
  });

  buildCheckboxList({
    boxId: "studioFilterBox",
    items: (STUDIO_ROWS || []).map(r => r.name),
    name: "studioFilter",
    searchInputId: "studioFilterSearch",
    onChange: rerenderFiltered
  });
}

function getCollectionViewMode() {
  return localStorage.getItem("collectionViewMode") || "mode-comfy"; // default
}
async function handlePasswordRecoveryIfPresent() {
  // This is for reset.html page or if Supabase redirects back with a code.
  // Safe to run on all pages: it only does work if a recovery "code" is present.
  try {
    const url = new URL(window.location.href);
    const hasCode = url.searchParams.has("code");
    const type = url.searchParams.get("type") || "";

    d("handlePasswordRecoveryIfPresent()", { hasCode, type, href: window.location.href });

    // If this is a recovery link, exchange it for a session
    if (hasCode && (type === "recovery" || type === "signup" || type === "")) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(window.location.href);
      d("exchangeCodeForSession result", { hasSession: !!data?.session, error: error?.message });

      if (error) {
        w("Password recovery link exchange failed", error);
        return;
      }

      // Clean URL so refreshes don't re-run the exchange
      url.searchParams.delete("code");
      url.searchParams.delete("type");
      window.history.replaceState({}, document.title, url.toString());

      d("Password recovery/session exchange complete; URL cleaned");
    }
  } catch (err) {
    e("handlePasswordRecoveryIfPresent failed:", err);
  }
}
function applyCollectionViewMode() {
  const mode = getCollectionViewMode();
  const targets = [el("collectionList"), el("collectionGrid")].filter(Boolean);
  targets.forEach(wrap => {
    wrap.classList.remove("mode-compact", "mode-comfy");
    wrap.classList.add(mode);
  });

  el("collectionViewCompact")?.classList.toggle("active", mode === "mode-compact");
  el("collectionViewComfy")?.classList.toggle("active", mode === "mode-comfy");
}

function setCollectionViewMode(mode) {
  localStorage.setItem("collectionViewMode", mode);
}

function setDisplay(id, show) {
  const node = el(id);
  if (!node) return;
  node.style.display = show ? "" : "none";
}

async function insertJoinRows({ joinTable, user_id, show_id, fkColumn, ids }) {
  if (!ids || !ids.length) return;

  const rows = ids.map(id => ({
    user_id,
    show_id,
    [fkColumn]: id
  }));

  const r = await supabase.from(joinTable).insert(rows);

  if (r.error) {
    console.error(`${joinTable} insert error:`, r.error, rows);
    if (msg) msg.textContent = `Error inserting ${joinTable}: ${r.error.message}`;
  }
}
async function mergeJoinRows({ joinTable, user_id, show_id, fkColumn, ids }) {
  const cleanIds = (ids || []).map(Number).filter(Boolean);
  if (!cleanIds.length) return;

  // read existing ids for this show
  const { data: existing, error: selErr } = await supabase
    .from(joinTable)
    .select(fkColumn)
    .eq("user_id", user_id)
    .eq("show_id", show_id);

  if (selErr) throw selErr;

  const have = new Set((existing || []).map(r => Number(r[fkColumn])).filter(Boolean));
  const toAdd = cleanIds.filter(id => !have.has(id));

  if (!toAdd.length) return;

  await insertJoinRows({ joinTable, user_id, show_id, fkColumn, ids: toAdd });
}
async function replaceJoinRows({ joinTable, user_id, show_id, fkColumn, ids }) {
  const cleanIds = (ids || []).map(Number).filter(Boolean);

  // 1) delete existing joins for this show/user
  const { error: delErr } = await supabase
    .from(joinTable)
    .delete()
    .eq("user_id", user_id)
    .eq("show_id", show_id);

  if (delErr) throw delErr;

  // 2) insert new joins (if any)
  if (!cleanIds.length) return;

  const rows = cleanIds.map(id => ({
    user_id,
    show_id,
    [fkColumn]: id
  }));

  const { error: insErr } = await supabase.from(joinTable).insert(rows);
  if (insErr) throw insErr;
}
async function namesToIds(tableName, names) {
  const cleanNames = (names || [])
    .map(x => String(x || "").trim())
    .filter(Boolean);

  const ids = [];
  for (const name of cleanNames) {
    const row = await getOrCreateOptionRow(tableName, name);
    if (row?.id) ids.push(row.id);
  }
  return ids;
}
function showAuthedUI(isAuthed) {
  d("showAuthedUI called:", { isAuthed });
  if (!isAuthed) {
    CURRENT_SESSION = null;
    CURRENT_USER_ID = null;
  }
   setDisplay("authCard", !isAuthed);
  setDisplay("app", isAuthed);

  const logout = el("logout");
  if (logout) logout.style.display = isAuthed ? "" : "none";


  // ✅ LOCK "Add Show" behind auth
  const openAdd = el("openAddShowBtn");
  if (openAdd) {
    openAdd.style.display = isAuthed ? "" : "none"; // hide it completely
    openAdd.disabled = !isAuthed;                   // extra safety
    openAdd.setAttribute("aria-disabled", String(!isAuthed));
  }

  // ✅ If logged out, force-close modal if it was open
  const modal = el("addShowModal");
  if (!isAuthed && modal) {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }

  if (!isAuthed) {
    ["home", "browse", "collection", "show"].forEach(name => setDisplay(`view-${name}`, false));
    snap("after showAuthedUI(false)");
    return;
  }

  // route() is controlled by init() / hashchange / auth change
  snap("after showAuthedUI(true)");
}
function showToast(message = "Show Successfully added!", ms = 2600) {
  const toast = el("toast");
  const toastText = el("toastText");
  if (!toast || !toastText) return;

  toastText.textContent = message;

  toast.classList.remove("hidden");
  // force reflow so transition works reliably
  void toast.offsetHeight;
  toast.classList.add("show");

  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.classList.add("hidden"), 200);
  }, ms);
}

function showAddBanner(message, ms = 3500) {
  const banner = el("addBanner");
  if (!banner) return;

  banner.textContent = message;
  banner.classList.remove("hidden");
  void banner.offsetHeight;
  banner.classList.add("show");

  clearTimeout(showAddBanner._t);
  showAddBanner._t = setTimeout(() => {
    banner.classList.remove("show");
    setTimeout(() => banner.classList.add("hidden"), 200);
  }, ms);
}

function closeAddShowModal() {
  const modal = el("addShowModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
}
function getMultiSelectValues(id) {
  const sel = el(id);
  if (!sel) return [];
  return Array.from(sel.selectedOptions).map(o => o.value).filter(Boolean);
}

function toIntOrNull(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toDateOrNull(v) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function syncOvaVisibility() {
  const cat = el("category")?.value;
  const isAnime = cat === "Anime";
  const block = el("ovaBlock");
  if (block) block.style.display = isAnime ? "" : "none";

  if (!isAnime) {
    const ovas = document.querySelector('input[name="ovas"]');
    const ovaLen = document.querySelector('input[name="ova_length_min"]');
    if (ovas) ovas.value = "";
    if (ovaLen) ovaLen.value = "";
  }
}
function syncFetchAnimeVisibility() {
  const cat = el("category")?.value || "";
  const isAnime = cat === "Anime";

  const btn = el("fetchAnimeBtn"); // <-- must match your HTML id
  if (btn) btn.style.display = isAnime ? "" : "none";
}
function syncProgressVisibility() {
  const status = el("status")?.value || document.querySelector('select[name="status"]')?.value;
  const isWatching = status === "Watching";

  const block = el("progressBlock");
  if (block) block.style.display = isWatching ? "" : "none";

  if (!isWatching) {
    const s = document.querySelector('input[name="current_season"]');
    const e2 = document.querySelector('input[name="current_episode"]');
    if (s) s.value = "";
    if (e2) e2.value = "";
  }
}
function extractYearFromDateInput(s) {
  if (!s) return null;

  // If it's YYYY-MM-DD (from <input type="date">)
  const iso = String(s).match(/^(\d{4})-\d{2}-\d{2}$/);
  if (iso) return iso[1];

  // If it's something like 10-20-1999 or 10/20/1999, grab a 4-digit year
  const m = String(s).match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}

function yearFromJikanAnime(a) {
  const from = a?.aired?.from;
  if (!from) return null;
  // from is typically ISO datetime like "1999-10-20T00:00:00+00:00"
  return String(from).slice(0, 4);
}

// Map your app's "Type" to what Jikan returns in a.type
function normalizeWantedJikanTypes(appType) {
  // Jikan a.type values: "TV", "Movie", "OVA", "Special", "ONA", "Music", etc.
  // Your app types: TV / Movie / TV & Movie (maybe others later)
  if (!appType) return null;

  const t = String(appType).toLowerCase();
  if (t === "tv") return ["TV"];
  if (t === "movie") return ["Movie"];
  if (t === "tv & movie") return ["TV", "Movie"]; // allow both
  return null;
}

async function fetchAnimeFromJikan(title, opts = {}) {
  const {
    releaseDate = null,     // a date string from your form (optional)
    useReleaseYear = false, // toggle
    showType = null         // "TV" / "Movie" / "TV & Movie" (optional)
  } = opts;

  const url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=10`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Jikan error: ${res.status}`);
  const json = await res.json();

  const results = json?.data || [];
  if (!results.length) return null;

  const wantedYear = useReleaseYear ? extractYearFromDateInput(releaseDate) : null;
  const wantedTypes = normalizeWantedJikanTypes(showType); // may be null

  // Score candidates instead of blindly taking results[0]
  const queryLower = String(title).trim().toLowerCase();

  function score(a) {
    let s = 0;

    // Prefer matching type (TV vs Movie)
    if (wantedTypes && a?.type) {
      if (wantedTypes.includes(a.type)) s += 6;
      else s -= 3;
    }

    // Prefer matching release year
    if (wantedYear) {
      const y = yearFromJikanAnime(a);
      if (y && y === wantedYear) s += 8;
      else if (y) s -= 2; // small penalty if year exists but doesn't match
    }

    // Boost exact-ish title matches (English / default title)
    const candTitles = [];
    if (a?.title) candTitles.push(a.title);
    if (a?.title_english) candTitles.push(a.title_english);
    if (Array.isArray(a?.titles)) {
      for (const t of a.titles) if (t?.title) candTitles.push(t.title);
    }

    const candLower = candTitles.map(x => String(x).trim().toLowerCase()).filter(Boolean);

    if (candLower.some(x => x === queryLower)) s += 5;
    if (candLower.some(x => x.includes(queryLower))) s += 2;

    // Small boost for more members/popularity signals (optional)
    if (typeof a?.members === "number") s += Math.min(2, a.members / 500000);

    return s;
  }

  // Pick best scored
  let best = results[0];
  let bestScore = -Infinity;

  for (const a of results) {
    const sc = score(a);
    if (sc > bestScore) {
      bestScore = sc;
      best = a;
    }
  }

  const release_date = best.aired?.from ? best.aired.from.split("T")[0] : null;

  const studios = (best.studios || []).map(s => s?.name).filter(Boolean);
  const genres = (best.genres || []).map(g => g?.name).filter(Boolean);
  const themes = (best.themes || []).map(t => t?.name).filter(Boolean);

  const canonical_title =
    (best.title_english && best.title_english.trim()) ||
    (Array.isArray(best.titles)
      ? (best.titles.find(x => x?.type === "English")?.title || "").trim()
      : "") ||
    (best.title && best.title.trim()) ||
    null;

  return {
    mal_id: best.mal_id ?? null,
    image_url: best.images?.jpg?.image_url ?? best.images?.webp?.image_url ?? null,
    description: best.synopsis ?? null,
    release_date,
    studios,
    genres,
    themes,
    canonical_title
  };
}
// async function fetchAnimeFromJikan(title) {
//   const url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=5`;
//   const res = await fetch(url);
//   if (!res.ok) throw new Error(`Jikan error: ${res.status}`);
//   const json = await res.json();

//   const results = json?.data || [];
//   if (!results.length) return null;

//   const a = results[0];

//   const release_date = a.aired?.from ? a.aired.from.split("T")[0] : null;

//   const studios = (a.studios || []).map(s => s?.name).filter(Boolean);
//   const genres = (a.genres || []).map(g => g?.name).filter(Boolean);
//   const themes = (a.themes || []).map(t => t?.name).filter(Boolean);

//   const canonical_title =
//     (a.title_english && a.title_english.trim()) ||
//     (Array.isArray(a.titles)
//       ? (a.titles.find(x => x?.type === "English")?.title || "").trim()
//       : "") ||
//     (a.title && a.title.trim()) ||
//     null;

//   return {
//     mal_id: a.mal_id ?? null,
//     image_url: a.images?.jpg?.image_url ?? a.images?.webp?.image_url ?? null,
//     description: a.synopsis ?? null,
//     release_date,
//     studios,
//     genres,
//     themes,
//     canonical_title
//   };
// }

function syncTypeVisibility() {
  const type = el("show_type")?.value || document.querySelector('select[name="show_type"]')?.value || "";

  const isTV = type === "TV" || type === "TV & Movie";
  const isMovie = type === "Movie" || type === "TV & Movie";

  const tvBlock = el("tvBlock");
  const movieBlock = el("movieBlock");

  if (tvBlock) tvBlock.style.display = isTV ? "" : "none";
  if (movieBlock) movieBlock.style.display = isMovie ? "" : "none";

  if (!isTV) {
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

function setupAddShowModal() {
  const modal = document.getElementById("addShowModal");
  const openBtn = document.getElementById("openAddShowBtn");
  const closeBtn = document.getElementById("closeAddShowBtn");

  if (!modal || !openBtn || !closeBtn) {
    console.warn("Add Show modal setup: missing elements");
    return;
  }

  async function openModal() {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) {
      w("Blocked Add Show: not logged in");
      showAuthedUI(false);
      return;
    }
    try {
      if (typeof ensureOptionRowsLoaded === "function") {
        await ensureOptionRowsLoaded();
      }

      modal.classList.add("is-open");
      modal.setAttribute("aria-hidden", "false");

      const first = modal.querySelector('input[name="title"]');
      if (first) first.focus();
    } catch (err) {
      console.error("openModal failed:", err);
    }
  }

  function closeModal() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }

  openBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("is-open")) {
      closeModal();
    }
  });
}

// ===============================
// DELETE MODAL STATE + HELPERS
// ===============================
let PENDING_DELETE = {
  showId: null,
  showTitle: "",
  redirectHash: "#collection"
};

const deleteBackdrop = el("deleteModalBackdrop");
const deleteShowNameEl = el("deleteModalShowName");
const deleteConfirmInput = el("deleteModalConfirmInput");
const deleteCancelBtn = el("deleteModalCancelBtn");
const deleteConfirmBtn = el("deleteModalConfirmBtn");
const deleteModalMsg = el("deleteModalMsg");

let lastFocusedBeforeModal = null;

function openDeleteModal({ showId, showTitle, redirectHash }) {
  if (!deleteBackdrop) return;

  lastFocusedBeforeModal = document.activeElement;

  PENDING_DELETE.showId = Number(showId);
  PENDING_DELETE.showTitle = String(showTitle || "");
  PENDING_DELETE.redirectHash = redirectHash || "#collection";

  if (deleteShowNameEl) deleteShowNameEl.textContent = PENDING_DELETE.showTitle || "this show";

  if (deleteConfirmInput) deleteConfirmInput.value = "";
  if (deleteConfirmBtn) deleteConfirmBtn.disabled = true;
  if (deleteModalMsg) deleteModalMsg.textContent = "";

  deleteBackdrop.classList.remove("hidden");
  deleteBackdrop.setAttribute("aria-hidden", "false");

  setTimeout(() => deleteConfirmInput?.focus(), 0);
}

function closeDeleteModal() {
  if (!deleteBackdrop) return;

  deleteBackdrop.classList.add("hidden");
  deleteBackdrop.setAttribute("aria-hidden", "true");

  if (lastFocusedBeforeModal && lastFocusedBeforeModal.focus) {
    lastFocusedBeforeModal.focus();
  }
}

function wireDeleteModal() {
  if (!deleteBackdrop) return;

  deleteCancelBtn?.addEventListener("click", closeDeleteModal);

  deleteBackdrop.addEventListener("click", (e) => {
    if (e.target === deleteBackdrop) closeDeleteModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !deleteBackdrop.classList.contains("hidden")) {
      closeDeleteModal();
    }
  });

  deleteConfirmInput?.addEventListener("input", () => {
    const ok = deleteConfirmInput.value.trim().toUpperCase() === "DELETE";
    if (deleteConfirmBtn) deleteConfirmBtn.disabled = !ok;
  });

  deleteConfirmBtn?.addEventListener("click", async () => {
    const id = PENDING_DELETE.showId;
    if (!id) return;

    deleteConfirmBtn.disabled = true;
    if (deleteModalMsg) deleteModalMsg.textContent = "Deleting…";

    try {
      await deleteShow(id);
      await loadShows();

      if (window.location.hash.startsWith("#show") && CURRENT_SHOW?.id === id) {
        window.location.hash = PENDING_DELETE.redirectHash || "#collection";
        route();
      }

      closeDeleteModal();
    } catch (err) {
      console.error(err);
      if (deleteModalMsg) deleteModalMsg.textContent = `Delete failed: ${err.message || err}`;
      const ok = deleteConfirmInput?.value.trim().toUpperCase() === "DELETE";
      deleteConfirmBtn.disabled = !ok;
    }
  });
}

// --------------------
// Filter helper functions
// --------------------
function buildCheckboxList({ boxId, items, name, searchInputId, onChange }) {
  const box = el(boxId);
  if (!box) return;

  function render(filterText = "") {
    const f = filterText.trim().toLowerCase();
    const list = f ? items.filter(x => String(x).toLowerCase().includes(f)) : items;

    box.innerHTML = list.map(val => `
      <label class="checkboxRow">
        <input type="checkbox" name="${name}" value="${escapeHtml(val)}" />
        <span>${escapeHtml(val)}</span>
      </label>
    `).join("");

    box.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener("change", onChange);
    });
  }

  render("");

  if (searchInputId) {
    const s = el(searchInputId);
    if (s) {
      s.addEventListener("input", debounce(() => render(s.value), 120));
    }
  }
}

function getCheckedValues(name) {
  return Array.from(document.querySelectorAll(`input[type="checkbox"][name="${name}"]:checked`))
    .map(cb => cb.value)
    .filter(Boolean);
}

function clearCheckboxGroup(name) {
  document.querySelectorAll(`input[type="checkbox"][name="${name}"]`).forEach(cb => { cb.checked = false; });
}

// --------------------
// Hash Router (Home / Browse / Collection / Show)
// --------------------
function route() {
  // d("route()", { hash: window.location.hash });

  // // Normalize hash to a view name: home/browse/collection/show
  // const rawHash = window.location.hash || "#home";
  // const raw = rawHash.replace(/^#/, "");       // remove leading #
  // const [first] = raw.split("?");              // strip query
  // const token = first || "home";

  // // Accept both formats: "collection" and "view-collection"
  // const normalized = token.startsWith("view-") ? token.slice(5) : token;

  // const views = ["home", "browse", "collection", "show"];
  // const name = views.includes(normalized) ? normalized : "home";
  d("route()", { hash: window.location.hash });

  const raw = (window.location.hash || "#home").slice(1);
  const [nameRaw0] = raw.split("?");
  const nameRaw = nameRaw0.startsWith("view-") ? nameRaw0.slice(5) : nameRaw0;

  const views = ["home", "browse", "collection", "show"];
  const name = views.includes(nameRaw) ? nameRaw : "home";
  // --------------------
  // AUTH GATE
  // --------------------
  const authed = !!CURRENT_SESSION || !!CURRENT_USER_ID;
  if (!authed) {
    showAuthedUI(false);
    return;
  }

  // --------------------
  // SHOW THE RIGHT VIEW
  // --------------------
  views.forEach(v => {
    setDisplay(`view-${v}`, v === name);

    // Tabs are only for home/browse/collection in your HTML
    const t = el(`tab-${v}`);
    if (t) t.classList.toggle("active", v === name);
  });

  // --------------------
  // VIEW-SPECIFIC LOGIC
  // --------------------
  if (name === "show") {
    const params = new URLSearchParams(raw.split("?")[1] || "");
    const id = params.get("id");
    if (id) loadShowDetail(Number(id));
  }

  if (name === "browse") rerenderFiltered();
  if (name === "collection") renderCollection();

  snap("after route()");
}

function wireTabs() {
  const nav = document.querySelector(".tabsRow");
  d("wireTabs()", { foundNav: !!nav });
  if (!nav) return;

  nav.addEventListener("click", (e) => {
    // ✅ If the user clicked the logout button, let logout handle it only
    if (e.target.closest("#logout")) {
      d("tabsRow click: ignored (logout)");
      return;
    }

    const a = e.target.closest('a.tab[href^="#"]');
    d("tabsRow click", { foundAnchor: !!a, href: a?.getAttribute("href") });

    if (!a) return;

    e.preventDefault();
    const hash = a.getAttribute("href");
    window.location.hash = hash;
    route();
  });
}
function wireBrowseFilterDrawer() {
  const toggleBtn = el("filtersToggle");
  const closeBtn  = el("filtersClose");

  const panel   = document.querySelector(".filters-drawer");
  const overlay = document.querySelector(".filters-overlay");

  if (!toggleBtn || !panel || !overlay) {
    w("wireBrowseFilterDrawer: missing", { toggleBtn: !!toggleBtn, panel: !!panel, overlay: !!overlay });
    return;
  }

  function open() {
    panel.classList.add("open");
    overlay.classList.remove("hidden");
    panel.setAttribute("aria-hidden", "false");
    toggleBtn.setAttribute("aria-expanded", "true");
  }

  function close() {
    panel.classList.remove("open");
    overlay.classList.add("hidden");
    panel.setAttribute("aria-hidden", "true");
    toggleBtn.setAttribute("aria-expanded", "false");
  }

  toggleBtn.addEventListener("click", () => panel.classList.contains("open") ? close() : open());
  closeBtn?.addEventListener("click", close);
  overlay.addEventListener("click", close);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("open")) close();
  });

  // ✅ ensure closed on boot
  close();
}
// function wireBrowseFilterDrawer() {
//   const toggleBtn = el("filtersToggle");
//   const closeBtn = el("filtersClose");
//   const panel = el("browseFiltersPanel");
//   const overlay = el("filtersOverlay");

//   if (!toggleBtn || !panel || !overlay) return;

//   function open() {
//     panel.classList.add("open");
//     overlay.classList.remove("hidden");
//     panel.setAttribute("aria-hidden", "false");
//     toggleBtn.setAttribute("aria-expanded", "true");
//   }

//   function close() {
//     panel.classList.remove("open");
//     overlay.classList.add("hidden");
//     panel.setAttribute("aria-hidden", "true");
//     toggleBtn.setAttribute("aria-expanded", "false");
//   }

//   toggleBtn.addEventListener("click", () => {
//     const isOpen = panel.classList.contains("open");
//     if (isOpen) close();
//     else open();
//   });

//   closeBtn?.addEventListener("click", close);
//   overlay.addEventListener("click", close);

//   document.addEventListener("keydown", (e2) => {
//     if (e2.key === "Escape" && panel.classList.contains("open")) close();
//   });
// }

// --------------------
// Browse render
// --------------------
function applyClientFilters(rows) {
  const q = (el("q")?.value || "").trim().toLowerCase();

  const statuses = getCheckedValues("statusFilter");
  const platformsWanted = getCheckedValues("platformFilter");
  const genresWanted = getCheckedValues("genreFilter");
  const tropesWanted = getCheckedValues("tropeFilter");
  const studiosWanted = getCheckedValues("studioFilter");
const categoriesWanted = getCheckedValues("categoryFilter");
const typesWanted = getCheckedValues("typeFilter");
  const minRatingVal =
    document.querySelector('input[type="radio"][name="minRatingFilter"]:checked')?.value || "";
  const minRating = minRatingVal ? Number(minRatingVal) : null;

  return (rows || []).filter(r => {
    if (q && !String(r.title || "").toLowerCase().includes(q)) return false;

    if (statuses.length && !statuses.includes(r.status)) return false;

    if (minRating != null) {
      const rs = r.rating_stars == null ? 0 : Number(r.rating_stars);
      if (rs < minRating) return false;
    }

    if (platformsWanted.length) {
      const rowPlatforms = (r.show_platforms || []).map(x => x.platforms?.name).filter(Boolean);
      if (!platformsWanted.some(p => rowPlatforms.includes(p))) return false;
    }
    if (categoriesWanted.length) {
  if (!categoriesWanted.includes(r.category)) return false;
}

if (typesWanted.length) {
  if (!typesWanted.includes(r.show_type)) return false;
}
    if (genresWanted.length) {
      const rowGenres = (r.show_genres || []).map(x => x.genres?.name).filter(Boolean);
      if (!genresWanted.some(g => rowGenres.includes(g))) return false;
    }

    if (tropesWanted.length) {
      const rowTropes = (r.show_tropes || []).map(x => x.tropes?.name).filter(Boolean);
      if (!tropesWanted.some(t => rowTropes.includes(t))) return false;
    }

    if (studiosWanted.length) {
      const rowStudios = (r.show_studios || []).map(x => x.studios?.name).filter(Boolean);
      if (!studiosWanted.some(s => rowStudios.includes(s))) return false;
    }

    return true;
  });
}

function rerenderFiltered() {
  const filtered = applyClientFilters(ALL_SHOWS_CACHE);
  renderTable(filtered);
  if (msg) msg.textContent = filtered.length ? "" : "No results.";
}

// --------------------
// Auth
// --------------------
async function getUserId() {
  if (CURRENT_USER_ID) return CURRENT_USER_ID;

  // fallback (in case called before restore completes)
  const { data, error } = await supabase.auth.getUser();
  if (error) w("getUserId getUser error:", error);
  CURRENT_USER_ID = data?.user?.id || null;
  return CURRENT_USER_ID;
}

async function logout(ev) {
  d("logout() clicked");
  if (ev?.preventDefault) ev.preventDefault();
  if (ev?.stopPropagation) ev.stopPropagation();

  snap("before logout");

  let signOutOk = false;

  try {
    d("calling supabase.auth.signOut({scope:'local'})…");
    const res = await withTimeoutAbort(
       (_signal) => supabase.auth.signOut({ scope: "local" }),
      2500,
      "signOut"
    );
    d("signOut resolved:", res);
    signOutOk = !res?.error;
    if (res?.error) w("signOut returned error:", res.error);
  } catch (err) {
    w("signOut threw/timed out:", err);
  }

  // If signOut didn’t complete, force-clear local tokens anyway
  if (!signOutOk) {
    w("signOut not confirmed; forcing local token clear");
    clearSupabaseLocalAuthTokens();
  }

  // Always force UI reset
  CURRENT_SHOW = null;
  EDIT_MODE = false;
  ALL_SHOWS_CACHE = [];

  showAuthedUI(false);

  // Move user to home + hard refresh to avoid “half logged in” state
  window.location.hash = "#home";
  route();

  snap("after logout (before reload)");

  // Hard reload ensures Supabase client + UI re-initialize cleanly
  setTimeout(() => location.reload(), 50);
}

// --------------------
// DB-backed MultiSelect (search + add new)
// --------------------
function setupDbMultiSelect({ buttonId, menuId, chipsId, tableName }) {
  const btn = el(buttonId);
  const menu = el(menuId);
  const chips = el(chipsId);

  if (!btn || !menu || !chips) {
    console.warn(`Missing multiselect elements for ${tableName}`, { buttonId, menuId, chipsId });
    return { setRows: () => {}, getIds: () => [], clear: () => {}, setSelectedRows: () => {} };
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
    searchEl.value = filterText;
    searchEl.focus({ preventScroll: true });
    searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length);

    searchEl.addEventListener("input", (e2) => {
      renderMenu(e2.target.value);
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

          if (tableName === "tropes" || tableName === "genres" || tableName === "platforms" || tableName === "studios") {
            refreshBrowseFilterOptions();
          }
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

  document.addEventListener("click", (e2) => {
    if (!menu.contains(e2.target) && e2.target !== btn) {
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
    },
    setSelectedRows: (rows) => {
      selected.clear();
      (rows || []).forEach(r => selected.set(r.id, r.name));
      renderChips();
    }
  };
}

// --------------------
// Home KPIs + Collection
// --------------------
function updateHomeCounts() {
  const rows = (ALL_SHOWS_CACHE || []);

  const statusCounts = {
    "To Be Watched": 0,
    "Watching": 0,
    "Waiting for Next Season": 0,
    "Watched": 0
  };

  for (const r of rows) {
    if (statusCounts[r.status] != null) statusCounts[r.status] += 1;
  }

  const map = [
    ["kpiToWatch", statusCounts["To Be Watched"]],
    ["kpiWatching", statusCounts["Watching"]],
    ["kpiWaiting", statusCounts["Waiting for Next Season"]],
    ["kpiWatched", statusCounts["Watched"]],
  ];

  map.forEach(([id, val]) => {
    const node = el(id);
    if (node) node.textContent = String(val);
  });

  const totalEl = el("kpiTotal");
  if (totalEl) totalEl.textContent = String(rows.length);

  const byCategory = {};
  for (const r of rows) {
    const cat = (r.category || "Uncategorized").trim();
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  }

 const preferred = [
  "Anime",
  "Western Animation",
  "Live-Action Series",
  "Reality / Competition",
  "Documentary",
  "Movies",
  "Animated Movies"
];
  const cats = Object.keys(byCategory);

  cats.sort((a, b) => {
    const ai = preferred.indexOf(a);
    const bi = preferred.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1) - (bi === -1) || ai - bi;
    return a.localeCompare(b);
  });

  const breakdownEl = el("kpiBreakdown");
  if (breakdownEl) {
    breakdownEl.textContent = cats.map(c => `${byCategory[c]} ${c}`).join("  |  ");
  }
}

const FALLBACK_POSTER = "./assets/poster-placeholder.png";

function getPosterUrl(item) {
  const s = String(item?.image_url ?? "").trim();
  return s ? s : FALLBACK_POSTER;
}
function createShowCardForRail(show) {
 return collectionCardHTML(show); }

function collectionCardHTML(r) {
  const poster = getPosterUrl(r);
  const title = r.title || "Untitled";
  const cat = r.category || "";
  const type = r.show_type || "";
  const status = r.status || "";
  const ongoing = r.ongoing || "";
  const rating = r.rating_stars ? starsDisplay(r.rating_stars) : "";

  const progress =
    (status === "Watching" && (r.current_season || r.current_episode))
      ? `S${r.current_season || "?"} · E${r.current_episode || "?"}`
      : "";

  return `
    <article class="media-card" data-id="${r.id}" role="button" tabindex="0">
      <img
        class="media-card__poster"
        src="${escapeHtml(poster)}"
        alt="${escapeHtml(title)} poster"
        loading="lazy"
        onerror="this.onerror=null;this.src='${FALLBACK_POSTER}';"
      />
      <div class="media-card__body">
        <div class="media-title">${escapeHtml(title)}</div>
        <div class="media-meta">
          ${[cat, type].filter(Boolean).length ? `<div>${escapeHtml([cat, type].filter(Boolean).join(" • "))}</div>` : ""}
          ${status ? `<div>Status: ${escapeHtml(status)}</div>` : ""}
          ${ongoing ? `<div>Ongoing: ${escapeHtml(ongoing)}</div>` : ""}
          ${progress ? `<div>${escapeHtml(progress)}</div>` : ""}
          ${rating ? `<div>${escapeHtml(rating)}</div>` : ""}
        </div>
      </div>
    </article>
  `;
}

function getCollectionRows() {
  const group = el("collectionGroup")?.value || "";
  const sort = el("collectionSort")?.value || "recent";

  let rows = (ALL_SHOWS_CACHE || []).slice();
  if (group) rows = rows.filter(r => r.category === group);

  if (sort === "alpha") {
    rows.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
  } else if (sort === "rating") {
    rows.sort((a, b) => (Number(b.rating_stars || 0) - Number(a.rating_stars || 0)));
  } else if (sort === "release_newest" || sort === "release_oldest") {
    rows.sort((a, b) => {
      const ad = a.release_date ? Date.parse(a.release_date) : (sort === "release_oldest" ? Infinity : -Infinity);
      const bd = b.release_date ? Date.parse(b.release_date) : (sort === "release_oldest" ? Infinity : -Infinity);
      return (sort === "release_oldest") ? (ad - bd) : (bd - ad);
    });
  } else {
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
  const wrap = el("collectionGrid"); //was collectionList, swapped while troubleshooting collection list
  const note = el("collectionMsg");
  if (!wrap) return;

  const mode = getCollectionViewMode();
  wrap.classList.remove("mode-compact", "mode-comfy");
  wrap.classList.add(mode);
  applyCollectionViewMode();

  const rows = getCollectionRows();

  if (!rows.length) {
    wrap.innerHTML = "";
    if (note) note.textContent = "No items yet (try switching filters or add a show).";
    return;
  }
  if (note) note.textContent = "";

  wrap.innerHTML = rows.map(collectionCardHTML).join("");
}
function wireHomeRailClicks() {
  const containers = [
    el("rail_currently_watching"),
    el("rail_recent_added"),
    el("rail_random")
  ].filter(Boolean);

  for (const wrap of containers) {
    // Click to open
    wrap.addEventListener("click", (e) => {
      const card = e.target.closest(".media-card");
      if (!card) return;
      const id = card?.dataset?.id;
      if (!id) return;

      window.location.hash = `#show?id=${id}`;
      route();
    });

    // Keyboard (Enter/Space) to open
    wrap.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const card = e.target.closest(".media-card");
      if (!card) return;
      e.preventDefault();

      const id = card?.dataset?.id;
      if (!id) return;

      window.location.hash = `#show?id=${id}`;
      route();
    });
  }
}
function wireCollectionClicks() {
  const wrap = el("collectionGrid"); //was collectionList, swapped while troubleshooting collection list
  if (!wrap) return;

  wrap.addEventListener("click", (e2) => {
    const card = e2.target.closest(".media-card");
    if (!card) return;
    const id = card?.dataset?.id;
    if (!id) return;

    window.location.hash = `#show?id=${id}`;
    route();
  });

  wrap.addEventListener("keydown", (e2) => {
    if (e2.key !== "Enter" && e2.key !== " ") return;
    const card = e2.target.closest(".media-card");
    if (!card) return;
    e2.preventDefault();
    const id = card.dataset.id;
    window.location.hash = `#show?id=${id}`;
    route();
  });
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
    return { clear: () => {}, set: () => {} };
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

  return {
    clear: () => set(0),
    set: (n) => set(Number(n) || 0)
  };
}

// --------------------
// DB helpers
// --------------------
async function loadOptionRows(tableName) {
  d(`loadOptionRows START: ${tableName}`);

  try {
    const r = await withTimeoutAbort(
      (signal) =>
        supabase
          .from(tableName)
          .select("id,name")
          .order("name")
          .abortSignal(signal),
      15000, // give it more room than 6s
      `loadOptionRows(${tableName})`
    );

    if (r.error) {
      w(`loadOptionRows ERROR: ${tableName}`, r.error);
      return [];
    }

    d(`loadOptionRows DONE: ${tableName}`, { count: r.data?.length || 0 });
    return r.data || [];
  } catch (err) {
    w(`loadOptionRows TIMEOUT/FAIL: ${tableName}`, err);
    return [];
  }
}

async function getOrCreateOptionRow(tableName, name) {
  const clean = String(name || "").trim();
  if (!clean) return null;

  const { data: found, error: findErr } = await supabase
    .from(tableName)
    .select("id,name")
    .ilike("name", clean)
    .limit(1);

  if (findErr) throw findErr;
  if (found && found[0]) return found[0];

  const { data: inserted, error: insErr } = await supabase
    .from(tableName)
    .insert({ name: clean })
    .select("id,name")
    .single();

  if (insErr) throw insErr;
  return inserted;
}

// --------------------
// CRUD
// --------------------
async function addShow(formData, platformIds, genreIds, tropeIds, studioIds) {
  const user_id = await getUserId();
  if (!user_id) {
    if (msg) msg.textContent = "You must be logged in.";
    return;
  }

  const title = formData.get("title").trim();
  const status = formData.get("status");
  const rating_stars = parseRatingStars(formData.get("my_rating"));
  const description = formData.get("description")?.trim() || null;
  const image_url = null;
  const category = formData.get("category") || "Anime";
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

  const ovas = (category === "Anime") ? toIntOrNull(formData.get("ovas")) : null;
  const ova_length_min = (category === "Anime") ? toIntOrNull(formData.get("ova_length_min")) : null;

  let last_watched = null;
  if (status === "Watched") {
    const d2 = new Date();
    d2.setHours(0, 0, 0, 0);
    last_watched = d2.toISOString().slice(0, 10);
  }
  if (status === "To Be Watched") last_watched = null;

  const ins = await supabase
    .from("shows")
    .insert([{
      user_id,
      title,
      status,
      last_watched,
      rating_stars,
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
      current_episode,
      description,
      image_url
    }])
    .select("id")
    .single();

  if (ins.error) {
    if (msg) msg.textContent = `Error: ${ins.error.message}`;
    return;
  }

  const show_id = ins.data.id;

  await insertJoinRows({ joinTable: "show_platforms", user_id, show_id, fkColumn: "platform_id", ids: platformIds });
  await insertJoinRows({ joinTable: "show_genres", user_id, show_id, fkColumn: "genre_id", ids: genreIds });
  await insertJoinRows({ joinTable: "show_tropes", user_id, show_id, fkColumn: "trope_id", ids: tropeIds });
  await insertJoinRows({ joinTable: "show_studios", user_id, show_id, fkColumn: "studio_id", ids: studioIds });

 if (msg) msg.textContent = "Added!";
return true;
}

async function deleteShow(id) {
  const user_id = await getUserId();
  if (!user_id) throw new Error("Not logged in.");

  const joinTables = [
    "show_platforms",
    "show_genres",
    "show_tropes",
    "show_studios"
  ];

  for (const jt of joinTables) {
    const delJoin = await supabase
      .from(jt)
      .delete()
      .eq("user_id", user_id)
      .eq("show_id", id);

    if (delJoin.error) {
      console.warn(`Join delete failed for ${jt}:`, delJoin.error);
    }
  }

  const { error } = await supabase
    .from("shows")
    .delete()
    .eq("id", id)
    .eq("user_id", user_id);

  if (error) {
    if (msg) msg.textContent = `Error: ${error.message}`;
    throw error;
  }
}

async function loadShows() {
  if (DEV_MODE) return;
d("loadShows starting");

const user_id = await getUserId();
d("user_id", user_id);
  if (msg) msg.textContent = "Loading…";

const { data, error } = await withTimeoutAbort(
  (signal) =>
    supabase
      .from("shows")
      .select(`
        id, user_id, title, status, rating_stars, last_watched, created_at,
        category, show_type, ongoing, release_date, rewatch_count,
        is_rewatching, last_rewatch_date,
        description, image_url,
        seasons, episodes, episode_length_min,
        movies, movie_length_min,
        ovas, ova_length_min,
        current_season, current_episode,
        show_platforms(platform_id, platforms(id, name)),
        show_genres(genre_id, genres(id, name)),
        show_tropes(trope_id, tropes(id, name)),
        show_studios(studio_id, studios(id, name))
      `)
      .order("created_at", { ascending: false })
      .abortSignal(signal),
  15000,
  "loadShows()"
);

  if (error) {
    if (msg) msg.textContent = `Error: ${error.message}`;
    return;
  }

  ALL_SHOWS_CACHE = data || [];
  rerenderFiltered();
  updateHomeCounts();
  renderCollection();
  if (msg) msg.textContent = "";

  d("loadShows result", {
  count: data?.length,
  error: error?.message
});
}

// --------------------
// Render table (Browse)
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
      <td><span class="row-link" data-open-id="${r.id}">${escapeHtml(r.title)}</span></td>
      <td>${escapeHtml(r.status)}</td>
      <td>${escapeHtml(starsDisplay(r.rating_stars))}</td>
      <td>${escapeHtml(platforms.join(", "))}</td>
      <td>${escapeHtml(genres.join(", "))}</td>
      <td>${escapeHtml(tropes.join(", "))}</td>
      <td>${escapeHtml(studios.join(", "))}</td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("[data-open-id]").forEach(span => {
    span.addEventListener("click", () => {
      const id = span.dataset.openId;
      window.location.hash = `#show?id=${id}`;
      route();
    });
  });
}

// --------------------
// Show detail (kept as-is from your file; only minimal glue here)
// --------------------
function labelVal(label, val) {
  const v2 = (val === null || val === undefined || val === "") ? "—" : String(val);
  return `<div class="factRow"><div class="factLabel muted">${escapeHtml(label)}</div><div class="factValue">${escapeHtml(v2)}</div></div>`;
}
function renderShowDetailBlocks(show, mode = "view") {
  d("renderShowDetailBlocks()", { id: show?.id, mode });

  // Poster
  const posterUrl = getPosterUrl(show);
  setImg("showPoster", posterUrl, `${show?.title || "Show"} poster`);
  // Show poster if we have an image_url OR fallback; you can choose behavior
  el("showPoster")?.classList.remove("hidden");

  // ---------- DESCRIPTION ----------
  const descHost = el("showDescriptionBlock");
  if (descHost) {
    if (mode === "edit") {
      descHost.innerHTML = `
        <label class="field" style="margin-top:8px;">
          <span>Description</span>
          <textarea id="edit_description" rows="5">${escapeHtml(show?.description || "")}</textarea>
        </label>
      `;
    } else {
      const desc = (show?.description || "").trim();
      descHost.innerHTML = desc
        ? `<p>${escapeHtml(desc).replaceAll("\n", "<br>")}</p>`
        : `<p class="muted">No description yet.</p>`;
    }
  }

  // ---------- NOTES ----------
  const notesHost = el("showNotesBlock");
  if (notesHost) {
    if (mode === "edit") {
      notesHost.innerHTML = `
        <label class="field">
          <span>Notes</span>
          <textarea id="edit_notes" rows="5">${escapeHtml(show?.notes || "")}</textarea>
        </label>
      `;
    } else {
      const notes = (show?.notes || "").trim();
      notesHost.innerHTML = notes
        ? `<p>${escapeHtml(notes).replaceAll("\n", "<br>")}</p>`
        : `<p class="muted">No notes yet.</p>`;
    }
  }
  // ---------- TAGS (Genres / Tropes / Studios) ----------
  const tagsHost = el("showTags");
  if (tagsHost) {
    if (mode === "edit") {
      tagsHost.innerHTML = `
        <div class="card innerCard" style="margin-top:12px;">
          <h3 style="margin-top:0;">Tags</h3>

          <div class="field">
            <span>Genres</span>
            <button type="button" id="editGenreBtn" class="secondary">Select genres</button>
            <div id="editGenreMenu" class="menu hidden"></div>
            <div id="editGenreChips" class="chips"></div>
          </div>

          <div class="field">
            <span>Tropes</span>
            <button type="button" id="editTropeBtn" class="secondary">Select tropes</button>
            <div id="editTropeMenu" class="menu hidden"></div>
            <div id="editTropeChips" class="chips"></div>
          </div>

          <div class="field">
            <span>Studios</span>
            <button type="button" id="editStudioBtn" class="secondary">Select studios</button>
            <div id="editStudioMenu" class="menu hidden"></div>
            <div id="editStudioChips" class="chips"></div>
          </div>

          <p class="muted small" style="margin:8px 0 0;">
            (Same dropdown behavior as Add Show — search + checkbox + add new.)
          </p>
        </div>
      `;
    } else {
      // keep your existing read-only display behavior
      const studios = (show?.show_studios || []).map(x => x.studios?.name).filter(Boolean);
      const genres  = (show?.show_genres  || []).map(x => x.genres?.name).filter(Boolean);
      const tropes  = (show?.show_tropes  || []).map(x => x.tropes?.name).filter(Boolean);

      tagsHost.innerHTML = `
        ${studios.length ? `<div><span class="muted">Studios:</span> ${escapeHtml(studios.join(", "))}</div>` : ""}
        ${genres.length ? `<div><span class="muted">Genres:</span> ${escapeHtml(genres.join(", "))}</div>` : ""}
        ${tropes.length ? `<div><span class="muted">Tropes:</span> ${escapeHtml(tropes.join(", "))}</div>` : ""}
        ${(!studios.length && !genres.length && !tropes.length) ? `<div class="muted">No tags yet.</div>` : ""}
      `;
    }
  }
  // ---------- YOUR INFO ----------
  const factsHost = el("showFactsBlock");
  if (factsHost) {
    if (mode === "edit") {
      factsHost.innerHTML = `
        <div class="grid" style="gap:10px;">

          <label class="field">
            <span>Status</span>
            <select id="edit_status">
              ${["To Be Watched","Watching","Waiting for Next Season","Watched","Dropped"]
                .map(s => `<option ${s === (show?.status || "") ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
            </select>
          </label>

          <label class="field">
            <span>Ongoing</span>
            <select id="edit_ongoing">
              <option value="" ${!show?.ongoing ? "selected" : ""}>—</option>
              ${["Yes","No","On Hiatus","To Be Released"]
                .map(v => `<option ${v === (show?.ongoing || "") ? "selected" : ""}>${escapeHtml(v)}</option>`).join("")}
            </select>
          </label>

          <label class="field">
            <span>Type</span>
            <select id="edit_show_type">
              <option value="" ${!show?.show_type ? "selected" : ""}>—</option>
              ${["TV","Movie","TV & Movie"]
                .map(v => `<option ${v === (show?.show_type || "") ? "selected" : ""}>${escapeHtml(v)}</option>`).join("")}
            </select>
          </label>

          <label class="field">
            <span>Release date</span>
            <input id="edit_release_date" type="date" value="${escapeHtml(show?.release_date || "")}" />
          </label>

          <label class="field">
            <span>Last watched</span>
            <input id="edit_last_watched" type="date" value="${escapeHtml(show?.last_watched || "")}" />
          </label>

          <label class="field">
            <span>Rating (0–5)</span>
            <input id="edit_rating" type="number" min="0" max="5" step="1" value="${show?.rating_stars ?? ""}" />
          </label>

          <label class="field">
            <span>Current season</span>
            <input id="edit_current_season" type="number" min="1" step="1" value="${show?.current_season ?? ""}" />
          </label>

          <label class="field">
            <span>Current episode</span>
            <input id="edit_current_episode" type="number" min="1" step="1" value="${show?.current_episode ?? ""}" />
          </label>

          <label class="field">
            <span># Seasons</span>
            <input id="edit_seasons" type="number" min="0" step="1" value="${show?.seasons ?? ""}" />
          </label>

          <label class="field">
            <span># Episodes</span>
            <input id="edit_episodes" type="number" min="0" step="1" value="${show?.episodes ?? ""}" />
          </label>

          <label class="field">
            <span>Ep length (min)</span>
            <input id="edit_episode_length_min" type="number" min="0" step="1" value="${show?.episode_length_min ?? ""}" />
          </label>

          <label class="field">
            <span># Movies</span>
            <input id="edit_movies" type="number" min="0" step="1" value="${show?.movies ?? ""}" />
          </label>

          <label class="field">
            <span>Movie length (min)</span>
            <input id="edit_movie_length_min" type="number" min="0" step="1" value="${show?.movie_length_min ?? ""}" />
          </label>

          ${
            (show?.category === "Anime")
              ? `
                <label class="field">
                  <span># OVAs</span>
                  <input id="edit_ovas" type="number" min="0" step="1" value="${show?.ovas ?? ""}" />
                </label>

                <label class="field">
                  <span>OVA length (min)</span>
                  <input id="edit_ova_length_min" type="number" min="0" step="1" value="${show?.ova_length_min ?? ""}" />
                </label>
              `
              : `
                <div class="muted small" style="grid-column:1 / -1;">OVA fields are only for Anime.</div>
              `
          }

        </div>
      `;
    } else {
      const infoBits = [
        labelVal("Status", show?.status),
        labelVal("Ongoing", show?.ongoing),
        labelVal("Type", show?.show_type),
        labelVal("Release date", show?.release_date),
        labelVal("Last watched", show?.last_watched),
        labelVal("Rating", show?.rating_stars ? starsDisplay(show.rating_stars) : null),
        labelVal("Current season", show?.current_season),
        labelVal("Current episode", show?.current_episode),
        labelVal("Seasons", show?.seasons),
        labelVal("Episodes", show?.episodes),
        labelVal("Ep length (min)", show?.episode_length_min),
        labelVal("Movies", show?.movies),
        labelVal("Movie length (min)", show?.movie_length_min),
        labelVal("OVAs", show?.ovas),
        labelVal("OVA length (min)", show?.ova_length_min),
      ].join("");
      factsHost.innerHTML = infoBits || `<div class="muted">No info yet.</div>`;
    }
  }
}

function setInlineEditMode(on) {
  EDIT_MODE = on;

  el("inlineEditBtn")?.style.setProperty("display", on ? "none" : "");
  el("inlineSaveBtn")?.style.setProperty("display", on ? "" : "none");
  el("inlineCancelBtn")?.style.setProperty("display", on ? "" : "none");

  // Hide legacy form if present
  const form = el("editForm");
  if (form) form.style.display = "none";

  if (CURRENT_SHOW) renderShowDetailBlocks(CURRENT_SHOW, on ? "edit" : "view");

  // ===== INIT INLINE TAG DROPDOWNS (CTRL+F: INIT INLINE TAG DROPDOWNS) =====
  if (on) {
    initInlineTagEditors().catch(err => console.error("initInlineTagEditors failed:", err));
  } else {
    // cleanup references so you don't accidentally read old selections
    EDIT_GENRE_SELECT = null;
    EDIT_TROPE_SELECT = null;
    EDIT_STUDIO_SELECT = null;
  }
}

async function initInlineTagEditors() {
  if (!CURRENT_SHOW) return;

  // Ensure option rows exist
  await ensureOptionRowsLoaded();

  // Create the dropdowns (same component as Add Show)
  EDIT_GENRE_SELECT = setupDbMultiSelect({
    buttonId: "editGenreBtn",
    menuId: "editGenreMenu",
    chipsId: "editGenreChips",
    tableName: "genres"
  });

  EDIT_TROPE_SELECT = setupDbMultiSelect({
    buttonId: "editTropeBtn",
    menuId: "editTropeMenu",
    chipsId: "editTropeChips",
    tableName: "tropes"
  });

  EDIT_STUDIO_SELECT = setupDbMultiSelect({
    buttonId: "editStudioBtn",
    menuId: "editStudioMenu",
    chipsId: "editStudioChips",
    tableName: "studios"
  });

  // Load rows into each
  // (use cached arrays if you want; reloading is also fine)
  const [gRows, tRows, sRows] = await Promise.all([
    loadOptionRows("genres"),
    loadOptionRows("tropes"),
    loadOptionRows("studios")
  ]);

  EDIT_GENRE_SELECT.setRows(gRows);
  EDIT_TROPE_SELECT.setRows(tRows);
  EDIT_STUDIO_SELECT.setRows(sRows);

  // Preselect current values from CURRENT_SHOW
  const currentGenres = (CURRENT_SHOW.show_genres || [])
    .map(x => x?.genres)
    .filter(Boolean)
    .map(r => ({ id: r.id, name: r.name }));

  const currentTropes = (CURRENT_SHOW.show_tropes || [])
    .map(x => x?.tropes)
    .filter(Boolean)
    .map(r => ({ id: r.id, name: r.name }));

  const currentStudios = (CURRENT_SHOW.show_studios || [])
    .map(x => x?.studios)
    .filter(Boolean)
    .map(r => ({ id: r.id, name: r.name }));

  EDIT_GENRE_SELECT.setSelectedRows(currentGenres);
  EDIT_TROPE_SELECT.setSelectedRows(currentTropes);
  EDIT_STUDIO_SELECT.setSelectedRows(currentStudios);
}
async function saveInlineEdits() {
  if (!CURRENT_SHOW?.id) return;

  const msgEl = el("showDetailMsg");
  if (msgEl) msgEl.textContent = "Saving…";

  const user_id = await getUserId();
  if (!user_id) {
    if (msgEl) msgEl.textContent = "Not logged in.";
    return;
  }

  const payload = {
    status: el("edit_status")?.value || CURRENT_SHOW.status,
    ongoing: el("edit_ongoing")?.value || null,
    show_type: el("edit_show_type")?.value || null,

    release_date: el("edit_release_date")?.value || null,
    last_watched: el("edit_last_watched")?.value || null,

    rating_stars: toIntOrNull(el("edit_rating")?.value),

    current_season: toIntOrNull(el("edit_current_season")?.value),
    current_episode: toIntOrNull(el("edit_current_episode")?.value),

    seasons: toIntOrNull(el("edit_seasons")?.value),
    episodes: toIntOrNull(el("edit_episodes")?.value),
    episode_length_min: toIntOrNull(el("edit_episode_length_min")?.value),

    movies: toIntOrNull(el("edit_movies")?.value),
    movie_length_min: toIntOrNull(el("edit_movie_length_min")?.value),

    ovas: (CURRENT_SHOW.category === "Anime") ? toIntOrNull(el("edit_ovas")?.value) : null,
    ova_length_min: (CURRENT_SHOW.category === "Anime") ? toIntOrNull(el("edit_ova_length_min")?.value) : null,

    description: el("edit_description")?.value?.trim() || null,
    notes: el("edit_notes")?.value?.trim() || null
  };

  const { error } = await supabase
    .from("shows")
    .update(payload)
    .eq("id", CURRENT_SHOW.id)
    .eq("user_id", user_id);

  if (error) {
    console.error(error);
    if (msgEl) msgEl.textContent = `Error: ${error.message}`;
    return;
  }
    try {
    const genreIds  = EDIT_GENRE_SELECT ? EDIT_GENRE_SELECT.getIds() : null;
    const tropeIds  = EDIT_TROPE_SELECT ? EDIT_TROPE_SELECT.getIds() : null;
    const studioIds = EDIT_STUDIO_SELECT ? EDIT_STUDIO_SELECT.getIds() : null;

    // Only run if the edit dropdowns exist (edit mode)
    if (genreIds) {
      await replaceJoinRows({
        joinTable: "show_genres",
        user_id,
        show_id: CURRENT_SHOW.id,
        fkColumn: "genre_id",
        ids: genreIds
      });
    }

    if (tropeIds) {
      await replaceJoinRows({
        joinTable: "show_tropes",
        user_id,
        show_id: CURRENT_SHOW.id,
        fkColumn: "trope_id",
        ids: tropeIds
      });
    }

    if (studioIds) {
      await replaceJoinRows({
        joinTable: "show_studios",
        user_id,
        show_id: CURRENT_SHOW.id,
        fkColumn: "studio_id",
        ids: studioIds
      });
    }
  } catch (joinErr) {
    console.error("Saving tag joins failed:", joinErr);
    if (msgEl) msgEl.textContent = `Saved show info, but tags failed: ${joinErr.message || joinErr}`;
    // don’t return — keep going so the user doesn’t lose the main save
  }
  if (msgEl) msgEl.textContent = "Saved!";
  setInlineEditMode(false);

  await loadShowDetail(CURRENT_SHOW.id);
  await loadShows();
}
// function renderShowDetailBlocks(show, mode = "view") {
//   d("renderShowDetailBlocks()", { id: show?.id, mode });

//   // Poster
//   const posterUrl = getPosterUrl(show);
//   const posterOk = setImg("showPoster", posterUrl, `${show?.title || "Show"} poster`);
//   if (!posterOk) w("Missing #showPoster (poster won't render)");

//   // Description
//   const desc = (show?.description || "").trim();
//   const descHtml = desc ? `<p>${escapeHtml(desc).replaceAll("\n", "<br>")}</p>` : `<p class="muted">No description yet.</p>`;
//   const descOk = setHtml("showDescriptionBlock", descHtml);
//   if (!descOk) w("Missing #showDescriptionBlock (description won't render)");

//   // Notes
//   const notes = (show?.notes || "").trim();
//   const notesHtml = notes ? `<p>${escapeHtml(notes).replaceAll("\n", "<br>")}</p>` : `<p class="muted">No notes yet.</p>`;
//   const notesOk = setHtml("showNotesBlock", notesHtml);
//   if (!notesOk) w("Missing #showNotesBlock(notes won't render)");

//   // “Your Info” card body
//   const infoBits = [
//     labelVal("Status", show?.status),
//     labelVal("Ongoing", show?.ongoing),
//     labelVal("Release date", show?.release_date),
//     labelVal("Last watched", show?.last_watched),
//     labelVal("Rating", show?.rating_stars ? starsDisplay(show.rating_stars) : null),
//     labelVal("Seasons", show?.seasons),
//     labelVal("Episodes", show?.episodes),
//     labelVal("Ep length (min)", show?.episode_length_min),
//     labelVal("Movies", show?.movies),
//     labelVal("Movie length (min)", show?.movie_length_min),
//     labelVal("OVAs", show?.ovas),
//     labelVal("OVA length (min)", show?.ova_length_min),
//   ].join("");

//   const infoOk = setHtml("showInfoBlock", infoBits || `<div class="muted">No info yet.</div>`);
//   if (!infoOk) w("Missing #showInfoBlock (your info won't render)");
// }
function updateFetchButtonLabel() {
  const btn = el("fetchAnimeBtn");
  if (!btn || !CURRENT_SHOW) return;
  btn.textContent = (CURRENT_SHOW.category === "Anime")
    ? "Fetch anime info"
    : "Fetch show info";
}
function renderShowDangerZone(show) {
  d("renderShowDangerZone()", { id: show?.id, title: show?.title });

 const host = el("showDangerZone");
  if (!host) return;

  host.innerHTML = `
    <div class="card innerCard" style="margin-top:12px;">
      <h3 style="margin-top:0;">Danger Zone</h3>
      <button id="deleteShowBtn" type="button" class="secondary">Delete show</button>
      <p class="muted small" style="margin-top:8px;">This cannot be undone.</p>
    </div>
  `;

  el("deleteShowBtn")?.addEventListener("click", () => {
    openDeleteModal({
      showId: show.id,
      showTitle: show.title,
      redirectHash: "#collection"
    });
  });
}
async function loadShowDetail(showId) {
const titleEl = el("showTitle");
const metaEl  = el("showMeta");
const msgEl   = el("showDetailMsg");

const posterEl = el("showPoster");
const descEl   = el("showDescriptionBlock");
const factsEl  = el("showFactsBlock");
const notesEl  = el("showNotesBlock");
const tagsEl   = el("showTags");


  if (msgEl) msgEl.textContent = "Loading…";

  const user_id = await getUserId();

  const { data, error } = await supabase
    .from("shows")
    .select(`
      id, user_id, title, status, rating_stars, last_watched, created_at,
      category, show_type, ongoing, release_date,
      seasons, episodes, episode_length_min, rewatch_count,
      is_rewatching, last_rewatch_date,
      notes, description, image_url, mal_id,
      movies, movie_length_min,
      ovas, ova_length_min,
      current_season, current_episode,
      show_platforms(platform_id, platforms(id, name)),
      show_genres(genre_id, genres(id, name)),
      show_tropes(trope_id, tropes(id, name)),
      show_studios(studio_id, studios(id, name))
    `)
    .eq("id", showId)
    .eq("user_id", user_id)
    .single();
if (msgEl) msgEl.textContent = "";
  
  if (error) {
    console.error("loadShowDetail error:", error);
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

  const platforms = (data.show_platforms || []).map(x => x.platforms?.name).filter(Boolean);
  const genres = (data.show_genres || []).map(x => x.genres?.name).filter(Boolean);
  const tropes = (data.show_tropes || []).map(x => x.tropes?.name).filter(Boolean);
  const studios = (data.show_studios || []).map(x => x.studios?.name).filter(Boolean);

// Poster
if (posterEl) {
  const url = getPosterUrl(data);
  posterEl.src = url;
  // showPoster starts with class="hidden" in HTML, so remove it when we have a real image
  posterEl.classList.toggle("hidden", !data.image_url);
  posterEl.onerror = () => {
    posterEl.onerror = null;
    posterEl.src = FALLBACK_POSTER;
    // optional: keep it visible or hide placeholder
    // posterEl.classList.add("hidden");
  };
}

// Description
if (descEl) {
  const desc = (data.description || "").trim();
  descEl.innerHTML = desc
    ? `<p>${escapeHtml(desc).replaceAll("\n", "<br>")}</p>`
    : `<p class="muted">No description yet.</p>`;
}

// Notes
if (notesEl) {
  const notes = (data.notes || "").trim();
  notesEl.innerHTML = notes
    ? `<p>${escapeHtml(notes).replaceAll("\n", "<br>")}</p>`
    : `<p class="muted">No notes yet.</p>`;
}

// Facts ("Your Info")
// NOTE: your existing function uses factsEl = el("showFacts") — change to showFactsBlock
if (factsEl) {
  factsEl.innerHTML = [
    labelVal("Ongoing", data.ongoing),
    labelVal("Release date", data.release_date),
    labelVal("Last watched", data.last_watched),
    labelVal("Current season", data.current_season),
    labelVal("Current episode", data.current_episode),
    labelVal("# Seasons", data.seasons),
    labelVal("# Episodes", data.episodes),
    labelVal("Episode length (min)", data.episode_length_min),
    labelVal("# Movies", data.movies),
    labelVal("Movie length (min)", data.movie_length_min),
    labelVal("# OVAs", data.ovas),
    labelVal("OVA length (min)", data.ova_length_min),
    labelVal("Rewatch count", data.rewatch_count),
    labelVal("Currently rewatching", data.is_rewatching ? "Yes" : "No"),
    labelVal("Last rewatch date", data.last_rewatch_date),
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

  CURRENT_SHOW = data;
const fetchBtn = el("fetchAnimeBtn");
const editMsg = el("editMsg");
}
// if (fetchBtn) {
//   fetchBtn.addEventListener("click", async () => {
//     if (!CURRENT_SHOW?.id) return;

//     fetchBtn.disabled = true;
//     if (editMsg) editMsg.textContent = "Fetching info…";

//     try {
//       const user_id = await getUserId();
//       if (!user_id) throw new Error("Not logged in");

//       // --------- 1) Fetch info from the right API ----------
//       let info = null;

//       if ((CURRENT_SHOW.category || "") === "Anime") {
//         info = await fetchAnimeFromJikan(CURRENT_SHOW.title);
//         if (!info) {
//           if (editMsg) editMsg.textContent = "No anime match found.";
//           return;
//         }
//       } else {
//         console.log("[FETCH NON-ANIME] clicked", {
//   id: CURRENT_SHOW?.id,
//   title: CURRENT_SHOW?.title,
//   category: CURRENT_SHOW?.category,
//   show_type: CURRENT_SHOW?.show_type
// });
//         info = await fetchShowFromTMDb(CURRENT_SHOW.title);
//         if (!info) {
//           if (editMsg) editMsg.textContent = "No show/movie match found.";
//           return;
//         }
//       }

//       // --------- 2) Update shows row (WITH WHERE CLAUSE) ----------
//       const updatePayload = {};

//       // common
//       if (info.image_url) updatePayload.image_url = info.image_url;
//       if (info.release_date) updatePayload.release_date = info.release_date;

//       // Anime: description + mal_id
//       if ((CURRENT_SHOW.category || "") === "Anime") {
//         if (info.mal_id != null) updatePayload.mal_id = info.mal_id;
//         if (info.description) updatePayload.description = info.description;
//       } else {
//         // Optional: store tmdb id if you have a column
//         // updatePayload.tmdb_id = info.tmdb_id ?? null;
//         // updatePayload.tmdb_media_type = info.media_type ?? null;
//       }

//       // canonical title (don’t set to null)
//       if (info.canonical_title && info.canonical_title.trim()) {
//         updatePayload.title = info.canonical_title.trim();
//       }

//       const { error: upErr } = await supabase
//         .from("shows")
//         .update(updatePayload)
//         .eq("id", CURRENT_SHOW.id); // ✅ REQUIRED

//       if (upErr) throw upErr;

//       // --------- 3) Upsert + APPEND genres/studios/tropes ----------
//       // Your existing helper should already exist:
//       //   getOrCreateOptionRow(tableName, name) -> returns row with id

//       // Studios
//       if (Array.isArray(info.studios) && info.studios.length) {
//         const studioIds = [];
//         for (const name of info.studios) {
//           const row = await getOrCreateOptionRow("studios", name);
//           if (row?.id) studioIds.push(row.id);
//         }
//         await appendJoinRows({
//           joinTable: "show_studios",
//           user_id,
//           show_id: CURRENT_SHOW.id,
//           fkColumn: "studio_id",
//           ids: studioIds
//         });
//       }

//       // Genres
//       if (Array.isArray(info.genres) && info.genres.length) {
//         const genreIds = [];
//         for (const name of info.genres) {
//           const row = await getOrCreateOptionRow("genres", name);
//           if (row?.id) genreIds.push(row.id);
//         }
//         await appendJoinRows({
//           joinTable: "show_genres",
//           user_id,
//           show_id: CURRENT_SHOW.id,
//           fkColumn: "genre_id",
//           ids: genreIds
//         });
//       }

//       // Tropes (Anime: you said you map Jikan themes -> tropes)
//       if ((CURRENT_SHOW.category || "") === "Anime" && Array.isArray(info.themes) && info.themes.length) {
//         const tropeIds = [];
//         for (const name of info.themes) {
//           const row = await getOrCreateOptionRow("tropes", name);
//           if (row?.id) tropeIds.push(row.id);
//         }
//         await appendJoinRows({
//           joinTable: "show_tropes",
//           user_id,
//           show_id: CURRENT_SHOW.id,
//           fkColumn: "trope_id",
//           ids: tropeIds
//         });
//       }

//       if (editMsg) editMsg.textContent = "Info updated!";
//       showToast("Info updated!");

//       await loadShowDetail(CURRENT_SHOW.id);
//       await loadShows();
//     } catch (err) {
//       console.error(err);
//       if (editMsg) editMsg.textContent = `Fetch failed: ${err.message || err}`;
//     } finally {
//       fetchBtn.disabled = false;
//       updateFetchButtonLabel();
//     }
//   });
// }
// }
function setText(id, text) {
  const n = el(id);
  if (!n) return false;
  n.textContent = text ?? "";
  return true;
}

function setHtml(id, html) {
  const n = el(id);
  if (!n) return false;
  n.innerHTML = html ?? "";
  return true;
}

function setImg(id, src, alt = "") {
  const n = el(id);
  if (!n) return false;
  n.src = src;
  n.alt = alt;
  return true;
}
function wireFetchButtons() {
  const fetchBtn = el("fetchAnimeBtn"); // you are reusing same button id
  const editMsg = el("editMsg");

  if (!fetchBtn) return;

  // IMPORTANT: using onclick replaces any previous handler (no stacking)
  fetchBtn.onclick = async () => {
    if (!CURRENT_SHOW) return;

    console.log("[FETCH] clicked", {
      id: CURRENT_SHOW.id,
      title: CURRENT_SHOW.title,
      category: CURRENT_SHOW.category
    });

    fetchBtn.disabled = true;
    if (editMsg) editMsg.textContent = "Fetching info…";

    try {
      const user_id = await getUserId();
      if (!user_id) throw new Error("Not authenticated");
      // ===== Read CURRENT form values (this enables "edit then click again") =====
      const titleEl = el("editTitle") || el("titleInput") || el("showTitle"); // use your real id
      const dateEl  = el("editReleaseDate") || el("releaseDateInput") || el("release_date"); // use your real id
      const toggleEl = el("useReleaseYearToggle"); // optional, add if you create it
      const typeEl = el("editType") || el("typeSelect"); // optional

      const liveTitle = (titleEl?.value ?? CURRENT_SHOW.title ?? "").trim();
      const liveReleaseDate = (dateEl?.value ?? "").trim();
      const useReleaseYear = toggleEl ? !!toggleEl.checked : !!liveReleaseDate; 
      // ^ if you don't have a toggle yet, this makes it auto-use year when date is present

      const liveType = typeEl?.value ?? null; // "TV" / "Movie" / "TV & Movie" if you have it

      // =====================================================
      // 🔵 ANIME → JIKAN
      // =====================================================
      if ((CURRENT_SHOW.category || "") === "Anime") {
        const info = await fetchAnimeFromJikan(liveTitle, {
          releaseDate: liveReleaseDate,
          useReleaseYear,
          showType: liveType
        });

        if (!info) {
          if (editMsg) editMsg.textContent = "No anime match found.";
          showToast("No anime match found.");
          return;
        }

        const updatePayload = {
          mal_id: info.mal_id,
          image_url: info.image_url,
          description: info.description,
          release_date: info.release_date
        };

        if (info.canonical_title) {
          updatePayload.title = info.canonical_title;
        }

        const { error } = await supabase
          .from("shows")
          .update(updatePayload)
          .eq("id", CURRENT_SHOW.id);

        if (error) throw error;

        await appendTagNames("studios", info.studios, user_id);
        await appendTagNames("genres", info.genres, user_id);
        await appendTagNames("tropes", info.themes, user_id);

        showToast("Anime info updated!");
      }
      // // =====================================================
      // // 🔵 ANIME → JIKAN
      // // =====================================================
      // if ((CURRENT_SHOW.category || "") === "Anime") {

      //   const info = await fetchAnimeFromJikan(CURRENT_SHOW.title);

      //   if (!info) {
      //     if (editMsg) editMsg.textContent = "No anime match found.";
      //     showToast("No anime match found.");
      //     return;
      //   }

      //   const updatePayload = {
      //     mal_id: info.mal_id,
      //     image_url: info.image_url,
      //     description: info.description,
      //     release_date: info.release_date
      //   };

      //   if (info.canonical_title) {
      //     updatePayload.title = info.canonical_title;
      //   }

      //   const { error } = await supabase
      //     .from("shows")
      //     .update(updatePayload)
      //     .eq("id", CURRENT_SHOW.id); // 🔴 CRITICAL FIX

      //   if (error) throw error;

      //   // ✅ APPEND TAGS (not replace)
      //   await appendTagNames("studios", info.studios, user_id);
      //   await appendTagNames("genres", info.genres, user_id);
      //   await appendTagNames("tropes", info.themes, user_id);

      //   showToast("Anime info updated!");
      // }

      // =====================================================
      // 🟢 NON-ANIME → TMDB
      // =====================================================
      else {

        const info = await fetchShowFromTMDb(CURRENT_SHOW.title);

        if (!info) {
          if (editMsg) editMsg.textContent = "No show/movie match found.";
          showToast("No match found.");
          return;
        }

        const updatePayload = {
          image_url: info.image_url,
          release_date: info.release_date,
           description: info.description 
        };

        if (info.canonical_title) {
          updatePayload.title = info.canonical_title;
        }

        const { error } = await supabase
          .from("shows")
          .update(updatePayload)
          .eq("id", CURRENT_SHOW.id); // 🔴 CRITICAL FIX

        if (error) throw error;

        // Append genres (TMDb only gives genres)
        await appendTagNames("genres", info.genres, user_id);
        await appendTagNames("studios", info.studios, user_id);
        showToast("Show info updated!");
      }

      if (editMsg) editMsg.textContent = "Updated successfully!";

      await loadShowDetail(CURRENT_SHOW.id);
      await loadShows();
    }
    catch (err) {
      console.error("[FETCH ERROR]", err);
      if (editMsg) editMsg.textContent =
        `Fetch failed: ${err.message || err}`;
    }
    finally {
      fetchBtn.disabled = false;
    }
  };
}

async function appendTagNames(type, names, user_id) {
  if (!Array.isArray(names) || !names.length) return;

  const joinMap = {
    studios:  { join: "show_studios",  fk: "studio_id",  table: "studios" },
    genres:   { join: "show_genres",   fk: "genre_id",   table: "genres" },
    tropes:   { join: "show_tropes",   fk: "trope_id",   table: "tropes" }
  };

  const cfg = joinMap[type];
  if (!cfg) return;

  for (const name of names) {
    const row = await getOrCreateOptionRow(cfg.table, name);
    if (!row) continue;
    
    await supabase
      .from(cfg.join)
      .upsert({
        user_id,
        show_id: CURRENT_SHOW.id,
        [cfg.fk]: row.id
      }, { onConflict: "user_id,show_id," + cfg.fk });
  }
}
function wireForgotPassword() {
  const forgotBtn = el("forgotBtn"); // <-- make sure this exists in HTML
  const loginErr = el("loginError") || el("authMsg") || el("msg");

  if (!forgotBtn) {
    d("wireForgotPassword: no #forgotBtn found (ok if you haven't added it yet)");
    return;
  }

  forgotBtn.addEventListener("click", async (e2) => {
    e2.preventDefault();

    const emailStr = (el("email")?.value || "").trim();
    if (!emailStr) {
      if (loginErr) loginErr.textContent = "Enter your email first, then click Forgot Password.";
      return;
    }

    const RESET_URL = new URL("reset.html", window.location.href).href;

    const { error } = await supabase.auth.resetPasswordForEmail(emailStr, {
      redirectTo: RESET_URL
    });

    if (error) {
      console.error("resetPasswordForEmail error:", error.message);
      if (loginErr) loginErr.textContent = "Reset failed: " + error.message;
      return;
    }

    if (loginErr) loginErr.textContent = "Reset email sent! Check your inbox.";
  });
}
function wireShowDetailButtons() {
  const fetchBtn  = el("fetchAnimeBtn");
  const editBtn   = el("inlineEditBtn");
  const saveBtn   = el("inlineSaveBtn");
  const cancelBtn = el("inlineCancelBtn");
  const form      = el("editForm");
  const editMsg   = el("editMsg");

  if (!fetchBtn || !editBtn || !saveBtn || !cancelBtn || !form) {
    d("wireShowDetailButtons: missing elements (ok if view-show not in DOM yet)");
    return;
  }

 fetchBtn.addEventListener("click", async () => {
  if (!CURRENT_SHOW) return;

  // ✅ Hide / block for non-Anime
  if ((CURRENT_SHOW.category || "") !== "Anime") {
    showToast("Anime info only (for Anime category).");
    return;
  }

  fetchBtn.disabled = true;
  if (editMsg) editMsg.textContent = "Fetching anime info…";

  try {
    const info = await fetchAnimeFromJikan(CURRENT_SHOW.title);
    if (!info) {
      if (editMsg) editMsg.textContent = "No anime match found.";
      return;
    }

    const user_id = await getUserId();
    if (!user_id) throw new Error("Not logged in.");

    // -------------------------
    // 1) Update show row (WITH WHERE!)
    // -------------------------
    const updatePayload = {
      mal_id: info.mal_id,
      image_url: info.image_url,
      // only fill these if empty, so you don't overwrite what you wrote
      description: CURRENT_SHOW.description ? CURRENT_SHOW.description : (info.description || null),
      release_date: CURRENT_SHOW.release_date ? CURRENT_SHOW.release_date : (info.release_date || null),
    };

    // If you want title standardization, set it here (or skip if you don't want auto-rename)
    if (info.canonical_title) {
      updatePayload.title = info.canonical_title;
    }

    const { error: updErr } = await supabase
      .from("shows")
      .update(updatePayload)
      .eq("id", CURRENT_SHOW.id)
      .eq("user_id", user_id);

    if (updErr) throw updErr;

    // -------------------------
    // 2) Merge tags (ADD, don't replace)
    // -------------------------

    // helper: turn current join rows into a Set of names
    const currentNames = (arr, path) =>
      new Set((arr || []).map(x => x?.[path]?.name).filter(Boolean).map(s => s.toLowerCase()));

    const currentStudioNames = new Set(
      (CURRENT_SHOW.show_studios || [])
        .map(x => x?.studios?.name)
        .filter(Boolean)
        .map(s => s.toLowerCase())
    );

    const currentGenreNames = new Set(
      (CURRENT_SHOW.show_genres || [])
        .map(x => x?.genres?.name)
        .filter(Boolean)
        .map(s => s.toLowerCase())
    );

    const currentTropeNames = new Set(
      (CURRENT_SHOW.show_tropes || [])
        .map(x => x?.tropes?.name)
        .filter(Boolean)
        .map(s => s.toLowerCase())
    );

    // studios/genres/themes come from Jikan
    const studiosToAdd = (info.studios || []).filter(n => !currentStudioNames.has(String(n).toLowerCase()));
    const genresToAdd  = (info.genres  || []).filter(n => !currentGenreNames.has(String(n).toLowerCase()));
    const tropesToAdd  = (info.themes  || []).filter(n => !currentTropeNames.has(String(n).toLowerCase())); // themes -> tropes

    // Ensure option rows exist + get ids
    const studioIds = [];
    for (const name of studiosToAdd) {
      const row = await getOrCreateOptionRow("studios", name);
      if (row?.id) studioIds.push(row.id);
    }

    const genreIds = [];
    for (const name of genresToAdd) {
      const row = await getOrCreateOptionRow("genres", name);
      if (row?.id) genreIds.push(row.id);
    }

    const tropeIds = [];
    for (const name of tropesToAdd) {
      const row = await getOrCreateOptionRow("tropes", name);
      if (row?.id) tropeIds.push(row.id);
    }

    // Insert ONLY the new join rows (do not delete existing)
    await insertJoinRows({ joinTable: "show_studios", user_id, show_id: CURRENT_SHOW.id, fkColumn: "studio_id", ids: studioIds });
    await insertJoinRows({ joinTable: "show_genres",  user_id, show_id: CURRENT_SHOW.id, fkColumn: "genre_id",  ids: genreIds });
    await insertJoinRows({ joinTable: "show_tropes",  user_id, show_id: CURRENT_SHOW.id, fkColumn: "trope_id",  ids: tropeIds });

    // If you ALSO want platform auto-add from MAL later, that'd be a different API/source.

    if (editMsg) editMsg.textContent = "Anime info updated!";
    showToast("Anime info updated!");

    // Reload detail (so CURRENT_SHOW has the newly added joins)
    await loadShowDetail(CURRENT_SHOW.id);
    await loadShows();
    await refreshBrowseFilterOptions();
  } catch (err) {
    console.error(err);
    if (editMsg) editMsg.textContent = `Fetch failed: ${err.message || err}`;
  } finally {
    fetchBtn.disabled = false;
  }
});

  editBtn.addEventListener("click", () => {
    if (!CURRENT_SHOW) return;
    enterEditModeFromCurrentShow();
  });

  cancelBtn.addEventListener("click", () => {
    exitEditMode();
  });

  saveBtn.addEventListener("click", async () => {
    if (!CURRENT_SHOW) return;

    saveBtn.disabled = true;
    if (editMsg) editMsg.textContent = "Saving…";

    try {
      const user_id = await getUserId();

      const payload = {
        status: form.querySelector("#edit_status")?.value || CURRENT_SHOW.status,
        rating_stars: toIntOrNull(form.querySelector("#edit_rating")?.value),
        last_watched: form.querySelector("#edit_last_watched")?.value || null,
        current_season: toIntOrNull(form.querySelector("#edit_current_season")?.value),
        current_episode: toIntOrNull(form.querySelector("#edit_current_episode")?.value),
        description: (form.querySelector("#edit_description")?.value || "").trim() || null,
        notes: (form.querySelector("#edit_notes")?.value || "").trim() || null,
        rewatch_count: toIntOrNull(form.querySelector("#edit_rewatch_count")?.value),
        is_rewatching: (form.querySelector("#edit_is_rewatching")?.value === "true"),
        last_rewatch_date: form.querySelector("#edit_last_rewatch_date")?.value || null,
      };

      const { error } = await supabase
        .from("shows")
        .update(payload)
        .eq("id", CURRENT_SHOW.id)
        .eq("user_id", user_id);

      if (error) throw error;

      if (editMsg) editMsg.textContent = "Saved!";
      showToast("Saved!");

      exitEditMode();
      await loadShowDetail(CURRENT_SHOW.id);
      await loadShows();
    } catch (err) {
      console.error(err);
      if (editMsg) editMsg.textContent = `Save failed: ${err.message || err}`;
      saveBtn.disabled = false;
    }
  });
}
function enterEditModeFromCurrentShow() {
  EDIT_MODE = true;

  const form = el("editForm");
  const editBtn = el("inlineEditBtn");
  const saveBtn = el("inlineSaveBtn");
  const cancelBtn = el("inlineCancelBtn");

  if (form) form.style.display = "";
  if (editBtn) editBtn.style.display = "none";
  if (saveBtn) saveBtn.style.display = "";
  if (cancelBtn) cancelBtn.style.display = "";

  // Fill form from CURRENT_SHOW
  if (!CURRENT_SHOW) return;

  el("edit_status").value = CURRENT_SHOW.status || "To Be Watched";
  el("edit_rating").value = (CURRENT_SHOW.rating_stars ?? "");
  el("edit_last_watched").value = CURRENT_SHOW.last_watched || "";
  el("edit_current_season").value = CURRENT_SHOW.current_season || "";
  el("edit_current_episode").value = CURRENT_SHOW.current_episode || "";
  el("edit_description").value = CURRENT_SHOW.description || "";
  el("edit_notes").value = CURRENT_SHOW.notes || "";
  el("edit_rewatch_count").value = CURRENT_SHOW.rewatch_count || 0;
  el("edit_is_rewatching").value = CURRENT_SHOW.is_rewatching ? "true" : "false";
  el("edit_last_rewatch_date").value = CURRENT_SHOW.last_rewatch_date || "";
}

function exitEditMode() {
  EDIT_MODE = false;

  const form = el("editForm");
  const editBtn = el("inlineEditBtn");
  const saveBtn = el("inlineSaveBtn");
  const cancelBtn = el("inlineCancelBtn");
  const editMsg = el("editMsg");

  if (form) form.style.display = "none";
  if (editBtn) editBtn.style.display = "";
  if (saveBtn) saveBtn.style.display = "none";
  if (cancelBtn) cancelBtn.style.display = "none";
  if (editMsg) editMsg.textContent = "";
  el("inlineSaveBtn") && (el("inlineSaveBtn").disabled = false);
}
// --------------------
// Filters UI builder
// --------------------
function buildBrowseFiltersUI() {
  buildCheckboxList({
    boxId: "statusFilterBox",
    items: STATUS_ITEMS,
    name: "statusFilter",
    onChange: rerenderFiltered
  });
buildCheckboxList({
  boxId: "categoryFilterBox",
  items: CATEGORY_ITEMS,
  name: "categoryFilter",
  onChange: rerenderFiltered
});

buildCheckboxList({
  boxId: "typeFilterBox",
  items: SHOW_TYPE_ITEMS,
  name: "typeFilter",
  onChange: rerenderFiltered
});
  buildCheckboxList({
    boxId: "platformFilterBox",
    items: (PLATFORM_ROWS || []).map(r => r.name),
    name: "platformFilter",
    searchInputId: "platformFilterSearch",
    onChange: rerenderFiltered
  });

  buildCheckboxList({
    boxId: "genreFilterBox",
    items: (GENRE_ROWS || []).map(r => r.name),
    name: "genreFilter",
    searchInputId: "genreFilterSearch",
    onChange: rerenderFiltered
  });

  buildCheckboxList({
    boxId: "tropeFilterBox",
    items: (TROPE_ROWS || []).map(r => r.name),
    name: "tropeFilter",
    searchInputId: "tropeFilterSearch",
    onChange: rerenderFiltered
  });

  buildCheckboxList({
    boxId: "studioFilterBox",
    items: (STUDIO_ROWS || []).map(r => r.name),
    name: "studioFilter",
    searchInputId: "studioFilterSearch",
    onChange: rerenderFiltered
  });

  buildMinRatingRadios();
}

function buildMinRatingRadios() {
  const box = el("minRatingBox");
  if (!box) return;

  const opts = ["", "1", "2", "3", "4", "5"]; // "" = Any
  box.innerHTML = opts.map(v3 => `
    <label class="checkboxRow">
      <input type="radio" name="minRatingFilter" value="${v3}" ${v3 === "" ? "checked" : ""}/>
      <span>${v3 === "" ? "Any" : `${v3}+`}</span>
    </label>
  `).join("");

  box.querySelectorAll('input[type="radio"][name="minRatingFilter"]').forEach(r => {
    r.addEventListener("change", rerenderFiltered);
  });
}

// --------------------
// Option rows loader (shared promise)
// --------------------


// ===== PATCH: ENSURE OPTIONS FAIL-OPEN =====
let OPTIONS_INFLIGHT = null;
async function ensureOptionRowsLoaded() {
  if (OPTIONS_INFLIGHT) return OPTIONS_INFLIGHT;

  OPTIONS_INFLIGHT = (async () => {
    d("ensureOptionRowsLoaded: START");

    try {
      const [p, g, t, s] = await Promise.all([
        loadOptionRows("platforms"),
        loadOptionRows("genres"),
        loadOptionRows("tropes"),
        loadOptionRows("studios"),
      ]);

      PLATFORM_ROWS = p;
      GENRE_ROWS = g;
      TROPE_ROWS = t;
      STUDIO_ROWS = s;

      d("ensureOptionRowsLoaded: DONE", {
        platforms: PLATFORM_ROWS?.length,
        genres: GENRE_ROWS?.length,
        tropes: TROPE_ROWS?.length,
        studios: STUDIO_ROWS?.length
      });
    } catch (err) {
      w("ensureOptionRowsLoaded FAILED (continuing anyway):", err);
      PLATFORM_ROWS ??= [];
      GENRE_ROWS ??= [];
      TROPE_ROWS ??= [];
      STUDIO_ROWS ??= [];
    } finally {
      OPTIONS_INFLIGHT = null; // allow refresh later
    }
  })();

  return OPTIONS_INFLIGHT;
}
// =====================
// ONE-TIME AUTH BOOTSTRAP
// =====================
let DID_AUTH_BOOTSTRAP = false;

// ===== PATCH: BOOTSTRAP FAIL-OPEN (OPTIONS MUST NOT BLOCK SHOWS) =====
// CTRL+F: "async function bootstrapWhenAuthed"
async function bootstrapWhenAuthed(origin = "unknown") {
  if (!CURRENT_SESSION) {
    d("bootstrapWhenAuthed: skipped (no CURRENT_SESSION)", { origin });
    return;
  }
  if (DID_AUTH_BOOTSTRAP) {
    d("bootstrapWhenAuthed: skipped (already bootstrapped)", { origin });
    return;
  }

  d("bootstrapWhenAuthed: RUN", { origin, userId: CURRENT_USER_ID });

  // We only mark bootstrapped AFTER shows load successfully
  // so a transient options timeout doesn't permanently lock you out.
  let showsLoadedOk = false;

  // 1) Try to load option rows, but NEVER let it block the app forever
  try {
    d("bootstrapWhenAuthed: ensureOptionRowsLoaded START", { origin });
    await ensureOptionRowsLoaded(); // make sure ensureOptionRowsLoaded/loadOptionRows have timeouts as discussed
    d("bootstrapWhenAuthed: ensureOptionRowsLoaded DONE", {
      platforms: PLATFORM_ROWS?.length,
      genres: GENRE_ROWS?.length,
      tropes: TROPE_ROWS?.length,
      studios: STUDIO_ROWS?.length
    });
  } catch (err) {
    // Fail-open: options may be empty, but we can still load shows
    w("bootstrapWhenAuthed: ensureOptionRowsLoaded failed (continuing)", err);
    PLATFORM_ROWS = PLATFORM_ROWS || [];
    GENRE_ROWS = GENRE_ROWS || [];
    TROPE_ROWS = TROPE_ROWS || [];
    STUDIO_ROWS = STUDIO_ROWS || [];
  }

  // 2) Build filters UI if possible (don't let it block)
  try {
    d("bootstrapWhenAuthed: buildBrowseFiltersUI START", { origin });
    buildBrowseFiltersUI();
    d("bootstrapWhenAuthed: buildBrowseFiltersUI DONE", { origin });
  } catch (err) {
    w("bootstrapWhenAuthed: buildBrowseFiltersUI failed (continuing)", err);
  }

  // 3) ALWAYS load shows (this is the real “logged in” experience)
  try {
    d("bootstrapWhenAuthed: loadShows START", { origin });
    await loadShows();
    showsLoadedOk = true;
    d("bootstrapWhenAuthed: loadShows DONE", { origin, count: ALL_SHOWS_CACHE?.length });
  } catch (err) {
    e("bootstrapWhenAuthed: loadShows FAILED", err);
    showsLoadedOk = false;
  }

  // 4) If shows loaded, finish boot; otherwise allow retry
  if (showsLoadedOk) {
    try {
      updateHomeCounts();
      renderCollection();
      route();
    } catch (err) {
      // Even if UI post-processing fails, we consider core bootstrap done
      w("bootstrapWhenAuthed: post-load UI steps failed", err);
    }

    DID_AUTH_BOOTSTRAP = true;
    d("bootstrapWhenAuthed: DONE", { origin });
  } else {
    // Allow retry on next auth event / manual refresh
    DID_AUTH_BOOTSTRAP = false;
    w("bootstrapWhenAuthed: NOT marked bootstrapped (shows not loaded)", { origin });
  }
}

function setEditMode(on) {
  EDIT_MODE = !!on;
  if (CURRENT_SHOW) renderShowDetailBlocks(CURRENT_SHOW, EDIT_MODE ? "edit" : "view");
}
// --------------------
// Init
// --------------------
async function init() {
  // single-init guard
  if (window.__WATCHLIST_INIT_RAN) {
    w("init() called AGAIN — duplicate bootstrap detected");
    snap("duplicate init");
    return;
  }
  window.__WATCHLIST_INIT_RAN = true;

  d("init() starting");
  snap("init start");

  // DOM sanity checks (this catches the classic “half logged in” issue fast)
  d("DOM sanity checks", {
    appCount: document.querySelectorAll("#app").length,
    authCard: !!document.getElementById("authCard"),
    logout: !!document.getElementById("logout"),
    tabsRow: !!document.querySelector(".tabsRow")
  });

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

  setupAddShowModal();
wireShowDetailButtons();
  wireFetchButtons()
// el("fetchAnimeBtn")?.addEventListener("click", async () => {
//   if (!CURRENT_SHOW?.id) return;

//   const msgEl = el("showDetailMsg");
//   if (msgEl) msgEl.textContent = "Fetching anime info…";

//   try {
//     const user_id = await getUserId();
//     const show_id = CURRENT_SHOW.id;

//     // Optional gate: only allow for Anime
//     const cat = (CURRENT_SHOW.category || "").trim();
//     if (cat && cat !== "Anime") {
//       if (msgEl) msgEl.textContent = "Fetch anime info is only available for Anime shows.";
//       return;
//     }

//     const title = (CURRENT_SHOW.title || "").trim();
//     const info = await fetchAnimeFromJikan(title);

//     if (!info) {
//       if (msgEl) msgEl.textContent = "No anime match found.";
//       return;
//     }

//     // 1) Update base show fields (WITH WHERE ✅)
//     const updatePayload = {
//       mal_id: info.mal_id,
//       image_url: info.image_url,
//       description: info.description,
//       release_date: info.release_date
//     };

//     // Title standardization (only if present)
//     if (info.canonical_title) updatePayload.title = info.canonical_title;

//     const upd = await supabase
//       .from("shows")
//       .update(updatePayload)
//       .eq("id", show_id)
//       .eq("user_id", user_id);

//     if (upd.error) throw upd.error;

//     // 2) Convert MAL names → option ids (themes → tropes)
//     const studioIds = await namesToIds("studios", info.studios);
//     const genreIds  = await namesToIds("genres", info.genres);
//     const tropeIds  = await namesToIds("tropes", info.themes);

//     // 3) MERGE into joins (add missing only; do NOT delete)
//     await mergeJoinRows({ joinTable: "show_studios", user_id, show_id, fkColumn: "studio_id", ids: studioIds });
//     await mergeJoinRows({ joinTable: "show_genres",  user_id, show_id, fkColumn: "genre_id",  ids: genreIds });
//     await mergeJoinRows({ joinTable: "show_tropes",  user_id, show_id, fkColumn: "trope_id",  ids: tropeIds });

//     // 4) Refresh UI
//     await loadShowDetail(show_id);
//     await loadShows();
//     await refreshBrowseFilterOptions();

//     if (msgEl) msgEl.textContent = "Anime info added!";
//   } catch (err) {
//     console.error("fetchAnimeBtn failed:", err);
//     if (msgEl) msgEl.textContent = `Fetch failed: ${err.message || err}`;
//   }
// });
logoutBtn?.addEventListener("click", (ev) => logout(ev));
  d("logout button sanity", {
  count: document.querySelectorAll("#logout").length,
  tag: el("logout")?.tagName,
  inTabsRow: !!el("logout")?.closest(".tabsRow")
});
  d("wired logout click:", { exists: !!logoutBtn });
  await handlePasswordRecoveryIfPresent();
  // --------------------
  // LOGIN wiring
  // --------------------
  const loginForm = el("loginForm");
  const loginBtn = el("sendLink");        // if your button has this id
  const loginErr = el("loginError");      // optional
  d("login wiring:", {
    loginForm: !!loginForm,
    loginBtn: !!loginBtn,
    emailField: !!el("email"),
    passwordField: !!el("password"),
  });

  // If your login is a FORM submit:
  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    d("loginForm submit fired");

    const email = el("email")?.value?.trim();
    const password = el("password")?.value;

    if (!email || !password) {
      if (loginErr) loginErr.textContent = "Email + password required.";
      w("login blocked: missing email/password", { email: !!email, password: !!password });
      return;
    }

    if (loginErr) loginErr.textContent = "";

    d("calling supabase.auth.signInWithPassword", { email });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    d("signInWithPassword result", {
      hasSession: !!data?.session,
      userId: data?.session?.user?.id,
      error: error?.message || null
    });

    if (error) {
      if (loginErr) loginErr.textContent = error.message;
      return;
    }

    // UI will update via onAuthStateChange
  });

  // If your login button is NOT type="submit" and you rely on click instead:
  loginBtn?.addEventListener("click", () => {
    d("login button clicked");
  });
  el("collectionViewCompact")?.addEventListener("click", () => {
    setCollectionViewMode("mode-compact");
    applyCollectionViewMode();
    renderCollection();
  });

  el("collectionViewComfy")?.addEventListener("click", () => {
    setCollectionViewMode("mode-comfy");
    applyCollectionViewMode();
    renderCollection();
  });
await loadHomeRails();
  applyCollectionViewMode();
el("inlineEditBtn")?.addEventListener("click", () => setInlineEditMode(true));
el("inlineCancelBtn")?.addEventListener("click", () => setInlineEditMode(false));
el("inlineSaveBtn")?.addEventListener("click", saveInlineEdits);
  // Add form (this is NOT login — debug label fixed)
  el("addForm")?.addEventListener("submit", async (e2) => {
    d("ADD SHOW submit clicked");
    snap("before add show submit");

    e2.preventDefault();

    if (DEV_MODE) {
      if (msg) msg.textContent = "DEV_MODE: not saving to DB.";
      return;
    }

    const form = e2.target;
    const titleInput = form.title;
    const title = titleInput.value.trim();
    if (!title) return;

    const errorEl = document.getElementById("addShowError");
    if (errorEl) errorEl.textContent = "";

    const normalizedTitle = title.toLowerCase().trim();

    const user = await supabase.auth.getUser();
    const userId = user?.data?.user?.id;
    d("duplicate check user", { userId });

    const { data: existing, error: dupErr } = await supabase
      .from("shows")
      .select("title")
      .eq("user_id", userId);

    if (dupErr) {
      console.error("Duplicate check failed:", dupErr);
      if (errorEl) errorEl.textContent = "Couldn’t validate title uniqueness. Try again.";
      return;
    }

    const duplicate = (existing || []).some(s =>
      (s.title || "").toLowerCase().trim() === normalizedTitle
    );

if (duplicate) {
  // old: errorEl.textContent = "You already added this show.";
  // NEW: loud banner inside modal
  showAddBanner("Show already exists!");
  titleInput.focus();
  return;
}

    const ok =  await addShow(
      new FormData(form),
      platformSelect.getIds(),
      genreSelect.getIds(),
      tropeSelect.getIds(),
      studioSelect.getIds()
    );

if (ok) {
  closeAddShowModal();
  showToast("Show Successfully added!");
}
    form.reset();
    starUI.clear();
    platformSelect.clear();
    genreSelect.clear();
    tropeSelect.clear();
    studioSelect.clear();
    syncOvaVisibility();

    await loadShows();
    await refreshBrowseFilterOptions();

    snap("after add show submit");
  });

  const rerender = debounce(rerenderFiltered, 150);
  el("q")?.addEventListener("input", rerender);

  el("clearFilters")?.addEventListener("click", () => {
    if (el("q")) el("q").value = "";

    clearCheckboxGroup("statusFilter");
    clearCheckboxGroup("platformFilter");
    clearCheckboxGroup("genreFilter");
    clearCheckboxGroup("tropeFilter");
    clearCheckboxGroup("studioFilter");
    clearCheckboxGroup("categoryFilter");
clearCheckboxGroup("typeFilter");
    const any = document.querySelector('input[type="radio"][name="minRatingFilter"][value=""]');
    if (any) any.checked = true;

    rerenderFiltered();
  });

  el("refresh")?.addEventListener("click", () => {
    if (DEV_MODE) rerenderFiltered();
    else loadShows();
  });
el("editShowBtn")?.addEventListener("click", () => setEditMode(true));
el("cancelEditBtn")?.addEventListener("click", () => setEditMode(false));
  // Router wiring
  wireTabs();
  wireBrowseFilterDrawer();
wireForgotPassword();
  window.addEventListener("hashchange", () => {
    d("hashchange event", { hash: window.location.hash });
    route();
    snap("after hashchange route");
  });

  wireCollectionClicks();
   wireHomeRailClicks();
  wireDeleteModal();

   if (!window.location.hash) window.location.hash = "#home";
  d("Router ready. Current hash =", window.location.hash);
  // ⚠️ DO NOT call route() yet — wait until we restore auth session below

el("category")?.addEventListener("change", () => {
  syncOvaVisibility();
  syncFetchAnimeVisibility();
});
syncOvaVisibility();
syncFetchAnimeVisibility();

  document.querySelector('select[name="status"]')?.addEventListener("change", syncProgressVisibility);
  syncProgressVisibility();

  el("show_type")?.addEventListener("change", syncTypeVisibility);
  syncTypeVisibility();

  el("collectionGroup")?.addEventListener("change", renderCollection);
  el("collectionSort")?.addEventListener("change", renderCollection);
el("backToCollection")?.addEventListener("click", () => {
  window.location.hash = "#collection";
  route();
});
  // DEV_MODE boot
  if (DEV_MODE) {
    showAuthedUI(true);
    if (authMsg) authMsg.textContent = "DEV_MODE: auth disabled (Supabase outage)";
    const send = el("sendLink");
    if (send) send.disabled = true;

    // (kept from your file; you can add dev rows here if you want)
    rerenderFiltered();
    return;
  }

  // Normal mode boot (Supabase)
  // Restore session FIRST (authoritative)
// Normal mode boot (Supabase)
d("about to restore session...");
const session = await restoreSessionOnLoad();
d("initial restoreSessionOnLoad (init)", { hasSession: !!session, userId: session?.user?.id });

showAuthedUI(!!session);
route();


snap("init end");

  // // If already logged in on refresh, do the full bootstrap
  // if (session) {
  //   await ensureOptionRowsLoaded();

  //   platformSelect.setRows(PLATFORM_ROWS);
  //   genreSelect.setRows(GENRE_ROWS);
  //   tropeSelect.setRows(TROPE_ROWS);
  //   studioSelect.setRows(STUDIO_ROWS);

  //   buildBrowseFiltersUI();
  //   await loadShows();
  //   updateHomeCounts();
  //   renderCollection();
  //   route();
  // }

  // snap("init end");
}

// Keep UI in sync when auth changes (login/logout)
supabase.auth.onAuthStateChange(async (event, session) => {
  d("onAuthStateChange fired:", {
    event,
    hasSession: !!session,
    userId: session?.user?.id,
    accessTokenStart: session?.access_token?.slice(0, 12)
  });

  // Update globals FIRST
  CURRENT_SESSION = session ?? null;
  CURRENT_USER_ID = session?.user?.id ?? null;

  // Keep UI correct immediately
  showAuthedUI(!!session);
  route();

  if (authMsg) authMsg.textContent = session ? "Logged in." : "Logged out.";

// If signed out, reset bootstrap so next login can run again
if (!session) {
  DID_AUTH_BOOTSTRAP = false;
  ALL_SHOWS_CACHE = [];
  return;
}

// ✅ only bootstrap once, on INITIAL_SESSION
if (event === "INITIAL_SESSION") {
  await bootstrapWhenAuthed("auth:INITIAL_SESSION");
}
});

// IMPORTANT NOTE:
// In your original pasted file, you had these lines at top-level:
//   buildBrowseFiltersUI();  
//   await loadShows();
//   updateHomeCounts();
// That would HARD BREAK the script (top-level await not allowed here),
// causing the “half logged in” / stuck UI behavior.
// They are intentionally removed — bootstrap now only happens inside init() or auth change.

init().catch(err => console.error("INIT FAILED:", err));
