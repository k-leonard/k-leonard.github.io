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
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
window.supabase = supabase;
d("Supabase client created");
supabase.auth.getSession().then(({ data, error }) => {
  d("getSession (early probe)", { hasSession: !!data?.session, error });
});

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

const STATUS_ITEMS = [
  "To Be Watched",
  "Watching",
  "Waiting for Next Season",
  "Watched",
  "Dropped"
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

function withTimeout(promise, ms, label = "timeout") {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function clearSupabaseLocalAuthTokens() {
  // Supabase stores tokens in localStorage keys like: sb-<project-ref>-auth-token
  const keys = Object.keys(localStorage);
  const removed = [];

  for (const k of keys) {
    if (k.startsWith("sb-") && (k.includes("auth-token") || k.includes("auth"))) {
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

async function fetchAnimeFromJikan(title) {
  const url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=5`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Jikan error: ${res.status}`);
  const json = await res.json();

  const results = json?.data || [];
  if (!results.length) return null;

  const a = results[0];

  const release_date = a.aired?.from ? a.aired.from.split("T")[0] : null;

  const studios = (a.studios || []).map(s => s?.name).filter(Boolean);
  const genres = (a.genres || []).map(g => g?.name).filter(Boolean);
  const themes = (a.themes || []).map(t => t?.name).filter(Boolean);

  const canonical_title =
    (a.title_english && a.title_english.trim()) ||
    (Array.isArray(a.titles)
      ? (a.titles.find(x => x?.type === "English")?.title || "").trim()
      : "") ||
    (a.title && a.title.trim()) ||
    null;

  return {
    mal_id: a.mal_id ?? null,
    image_url: a.images?.jpg?.image_url ?? a.images?.webp?.image_url ?? null,
    description: a.synopsis ?? null,
    release_date,
    studios,
    genres,
    themes,
    canonical_title
  };
}

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
  d("route()", { hash: window.location.hash });

  const raw = (window.location.hash || "#home").slice(1);
  const [nameRaw] = raw.split("?");
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
  views.forEach(v => {
    setDisplay(`view-${v}`, v === name);
    const t = el(`tab-${v}`);
    if (t) t.classList.toggle("active", v === name);
  });

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
  const closeBtn = el("filtersClose");
  const panel = el("browseFiltersPanel");
  const overlay = el("filtersOverlay");

  if (!toggleBtn || !panel || !overlay) return;

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

  toggleBtn.addEventListener("click", () => {
    const isOpen = panel.classList.contains("open");
    if (isOpen) close();
    else open();
  });

  closeBtn?.addEventListener("click", close);
  overlay.addEventListener("click", close);

  document.addEventListener("keydown", (e2) => {
    if (e2.key === "Escape" && panel.classList.contains("open")) close();
  });
}

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
  renderTable(applyClientFilters(ALL_SHOWS_CACHE));
  if (msg) msg.textContent = applyClientFilters(ALL_SHOWS_CACHE).length ? "" : "No results.";
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
    const res = await withTimeout(
      supabase.auth.signOut({ scope: "local" }),
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

  const preferred = ["Anime", "Non-anime"];
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
  const wrap = el("collectionList");
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

function wireCollectionClicks() {
  const wrap = el("collectionList");
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
  const r = await supabase.from(tableName).select("id,name").order("name");
  if (r.error) {
    console.error(`${tableName} load error:`, r.error);
    return [];
  }
  return r.data || [];
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

  const { data, error } = await supabase
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
    .order("created_at", { ascending: false });

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
  const posterOk = setImg("showPoster", posterUrl, `${show?.title || "Show"} poster`);
  if (!posterOk) w("Missing #showPoster (poster won't render)");

  // Description
  const desc = (show?.description || "").trim();
  const descHtml = desc ? `<p>${escapeHtml(desc).replaceAll("\n", "<br>")}</p>` : `<p class="muted">No description yet.</p>`;
  const descOk = setHtml("showDescriptionBlock", descHtml);
  if (!descOk) w("Missing #showDescriptionBlock (description won't render)");

  // Notes
  const notes = (show?.notes || "").trim();
  const notesHtml = notes ? `<p>${escapeHtml(notes).replaceAll("\n", "<br>")}</p>` : `<p class="muted">No notes yet.</p>`;
  const notesOk = setHtml("showNotesBody", notesHtml);
  if (!notesOk) w("Missing #showNotesBody (notes won't render)");

  // “Your Info” card body
  const infoBits = [
    labelVal("Status", show?.status),
    labelVal("Ongoing", show?.ongoing),
    labelVal("Release date", show?.release_date),
    labelVal("Last watched", show?.last_watched),
    labelVal("Rating", show?.rating_stars ? starsDisplay(show.rating_stars) : null),
    labelVal("Seasons", show?.seasons),
    labelVal("Episodes", show?.episodes),
    labelVal("Ep length (min)", show?.episode_length_min),
    labelVal("Movies", show?.movies),
    labelVal("Movie length (min)", show?.movie_length_min),
    labelVal("OVAs", show?.ovas),
    labelVal("OVA length (min)", show?.ova_length_min),
  ].join("");

  const infoOk = setHtml("showInfoBody", infoBits || `<div class="muted">No info yet.</div>`);
  if (!infoOk) w("Missing #showInfoBody (your info won't render)");
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

  // NOTE: your original file calls these; keep them if they exist in your file.
  if (typeof renderShowDetailBlocks === "function") {
    renderShowDetailBlocks(CURRENT_SHOW, EDIT_MODE ? "edit" : "view");
  }
  if (typeof renderShowDangerZone === "function") {
    renderShowDangerZone(CURRENT_SHOW);
  }
}

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
function wireForgotPassword() {
  const forgotBtn = el("forgotPasswordBtn"); // <-- make sure this exists in HTML
  const loginErr = el("loginError") || el("authMsg") || el("msg");

  if (!forgotBtn) {
    d("wireForgotPassword: no #forgotPasswordBtn found (ok if you haven't added it yet)");
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
let optionsLoadPromise = null;

async function ensureOptionRowsLoaded() {
  if (PLATFORM_ROWS && GENRE_ROWS && TROPE_ROWS && STUDIO_ROWS) return;
  if (optionsLoadPromise) return optionsLoadPromise;

  optionsLoadPromise = (async () => {
    PLATFORM_ROWS = await loadOptionRows("platforms");
    GENRE_ROWS    = await loadOptionRows("genres");
    TROPE_ROWS    = await loadOptionRows("tropes");
    STUDIO_ROWS   = await loadOptionRows("studios");
  })();

  try {
    await optionsLoadPromise;
  } finally {
    optionsLoadPromise = null;
  }
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

  applyCollectionViewMode();

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
      if (errorEl) errorEl.textContent = "You already added this show.";
      titleInput.focus();
      return;
    }

    await addShow(
      new FormData(form),
      platformSelect.getIds(),
      genreSelect.getIds(),
      tropeSelect.getIds(),
      studioSelect.getIds()
    );

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

    const any = document.querySelector('input[type="radio"][name="minRatingFilter"][value=""]');
    if (any) any.checked = true;

    rerenderFiltered();
  });

  el("refresh")?.addEventListener("click", () => {
    if (DEV_MODE) rerenderFiltered();
    else loadShows();
  });

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
  wireDeleteModal();

   if (!window.location.hash) window.location.hash = "#home";
  d("Router ready. Current hash =", window.location.hash);
  // ⚠️ DO NOT call route() yet — wait until we restore auth session below

  el("category")?.addEventListener("change", syncOvaVisibility);
  syncOvaVisibility();

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
    d("about to restore session...");
  const session = await restoreSessionOnLoad();
  d("initial restoreSessionOnLoad (init)", { hasSession: !!session, userId: session?.user?.id });

  showAuthedUI(!!session);

  // Now that auth UI is correct, route safely
  route();

  // If already logged in on refresh, do the full bootstrap
  if (session) {
    await ensureOptionRowsLoaded();

    platformSelect.setRows(PLATFORM_ROWS);
    genreSelect.setRows(GENRE_ROWS);
    tropeSelect.setRows(TROPE_ROWS);
    studioSelect.setRows(STUDIO_ROWS);

    buildBrowseFiltersUI();
    await loadShows();
    updateHomeCounts();
    renderCollection();
    route();
  }

  snap("init end");
}

// Keep UI in sync when auth changes (login/logout)
supabase.auth.onAuthStateChange(async (event, session) => {
  d("onAuthStateChange fired:", {
    event,
    hasSession: !!session,
    userId: session?.user?.id,
    accessTokenStart: session?.access_token?.slice(0, 12)
  });

  // ✅ update globals FIRST
  CURRENT_SESSION = session ?? null;
  CURRENT_USER_ID = session?.user?.id ?? null;

  showAuthedUI(!!session);
  route(); // ✅ route immediately so views show even if bootstrap fails

  if (authMsg) authMsg.textContent = session ? "Logged in." : "Logged out.";
  if (!session) return;

  try {
    await ensureOptionRowsLoaded();
    buildBrowseFiltersUI();
    await loadShows();
    updateHomeCounts();
    renderCollection();
  } catch (err) {
    e("Post-login bootstrap failed:", err);
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
