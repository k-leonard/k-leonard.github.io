import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEV_MODE = false; //allows me to still work on aspects if supabase is down, although i do think there are rendering issues i need to address
console.log("WATCHLIST app.js loaded - DEV_MODE =", DEV_MODE);
 
// -------------------
// Constants
// -------------------
const SUPABASE_URL = "https://lldpkdwbnlqfuwjbbirt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsZHBrZHdibmxxZnV3amJiaXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NTc3NTcsImV4cCI6MjA4NjQzMzc1N30.OGKn4tElV2k1_ZJKOVjPxBSQUixZB5ywMYo5eGZTDe4";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let CURRENT_SHOW = null;
let EDIT_MODE = false; 
const el = (id) => document.getElementById(id);
const msg = el("msg"); // <-- add this

const authMsg = el("authMsg");
const browseMsg = el("msg");
const homeMsg = el("homeMsg");
let PLATFORM_ROWS = [];
let GENRE_ROWS = [];
let TROPE_ROWS = [];
let STUDIO_ROWS = [];

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
    // surface it so you SEE it
    if (msg) msg.textContent = `Error inserting ${joinTable}: ${r.error.message}`;
  }
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
async function fetchAnimeFromJikan(title) {
  const url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=5`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Jikan error: ${res.status}`);
  const json = await res.json();

  const results = json?.data || [];
  if (!results.length) return null;

  // Pick best match (simple: first result). Later you can improve ranking.
  const a = results[0];

  return {
    mal_id: a.mal_id ?? null,
    image_url: a.images?.jpg?.image_url ?? a.images?.webp?.image_url ?? null,
    description: a.synopsis ?? null
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
// Filter helper functions
// --------------------
function uniqSorted(arr) {
  return Array.from(new Set((arr || []).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)));
}

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

    // When any checkbox changes, rerender results
    box.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener("change", onChange);
    });
  }

  // initial render
  render("");

  // wire search-within (optional)
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
// Hash Router (Home / Browse / / Show Tab)
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
   if (name === "browse") rerenderFiltered();
  if (name === "collection") renderCollection();
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

  // Escape to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("open")) close();
  });
}

// function renderCollectionCards() {
//   const wrap = el("collectionList");
//   if (!wrap) return;

//   if (!ALL_SHOWS_CACHE.length) {
//     wrap.textContent = "No shows yet.";
//     return;
//   }

//   // basic sorting options
//   const sort = el("collectionSort")?.value || "recent";
//   const group = el("collectionGroup")?.value || "";

//   let rows = ALL_SHOWS_CACHE.slice();

//   if (group) rows = rows.filter(r => r.category === group);

//   if (sort === "alpha") {
//     rows.sort((a, b) => String(a.title).localeCompare(String(b.title)));
//   } else if (sort === "rating") {
//     rows.sort((a, b) => (b.rating_stars ?? -1) - (a.rating_stars ?? -1));
//   } else {
//     // recent (created_at newest first) - if created_at exists
//     rows.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
//   }

//   wrap.innerHTML = rows.map(r => {
//     const rating = r.rating_stars ? starsDisplay(r.rating_stars) : "";
//     const status = r.status || "";
//     const type = r.show_type || "";
//     const cat = r.category || "";
//     return `
//       <button class="collectionCard" type="button" data-id="${r.id}">
//         <div class="collectionTitle">${escapeHtml(r.title)}</div>
//         <div class="collectionMeta muted">${escapeHtml([cat, type, status].filter(Boolean).join(" • "))}</div>
//         <div class="collectionMeta">${escapeHtml(rating)}</div>
//       </button>
//     `;
//   }).join("");

//   wrap.querySelectorAll(".collectionCard").forEach(btn => {
//     btn.addEventListener("click", () => {
//       const id = btn.dataset.id;
//       window.location.hash = `#show?id=${id}`;
//       route();
//     });
//   });
// }
//---------------------
// inline render helpers
//--------------------
function v(val) {
  return (val === null || val === undefined || val === "") ? "—" : String(val);
}

function inputRow(label, id, type, value) {
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <input id="${id}" type="${type}" value="${escapeHtml(value ?? "")}" />
    </label>
  `;
}

function numberRow(label, id, value, min = 0) {
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <input id="${id}" type="number" min="${min}" step="1" value="${value ?? ""}" />
    </label>
  `;
}

function dateRow(label, id, value) {
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <input id="${id}" type="date" value="${value ?? ""}" />
    </label>
  `;
}

function selectRow(label, id, options, value) {
  const opts = options.map(o => {
    const sel = String(o.value) === String(value) ? "selected" : "";
    return `<option value="${escapeHtml(o.value)}" ${sel}>${escapeHtml(o.label)}</option>`;
  }).join("");
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <select id="${id}">${opts}</select>
    </label>
  `;
}

// the actual function
function renderShowDetailBlocks(show, mode) {
  const facts = el("showFactsBlock");
  const desc = el("showDescriptionBlock");
  const notes = el("showNotesBlock");

  if (!facts || !desc || !notes) return;

  if (mode === "view") {
    const poster = el("showPoster");
  if (poster) {
    if (show.image_url) {
      poster.src = show.image_url;
      poster.classList.remove("hidden");
    } else {
      poster.classList.add("hidden");
    }
  }
    desc.innerHTML = `<p class="muted">${escapeHtml(show.description?.trim() || "(No description yet.)")}</p>`;
    notes.innerHTML = `<p class="muted">${escapeHtml(show.notes?.trim() || "(No notes.)")}</p>`;

    facts.innerHTML = `
      <div class="factRow"><div class="factLabel muted">Status</div><div class="factValue">${escapeHtml(v(show.status))}</div></div>
      <div class="factRow"><div class="factLabel muted">Ongoing</div><div class="factValue">${escapeHtml(v(show.ongoing))}</div></div>
      <div class="factRow"><div class="factLabel muted">Type</div><div class="factValue">${escapeHtml(v(show.show_type))}</div></div>
      <div class="factRow"><div class="factLabel muted">Release date</div><div class="factValue">${escapeHtml(v(show.release_date))}</div></div>
      <div class="factRow"><div class="factLabel muted">Last watched</div><div class="factValue">${escapeHtml(v(show.last_watched))}</div></div>
      <div class="factRow"><div class="factLabel muted">Rating</div><div class="factValue">${escapeHtml(show.rating_stars ? starsDisplay(show.rating_stars) : "—")}</div></div>

      <hr style="border:none;border-top:1px solid #eef0f6; margin:10px 0;" />

      <div class="factRow"><div class="factLabel muted">Current season</div><div class="factValue">${escapeHtml(v(show.current_season))}</div></div>
      <div class="factRow"><div class="factLabel muted">Current episode</div><div class="factValue">${escapeHtml(v(show.current_episode))}</div></div>

      <hr style="border:none;border-top:1px solid #eef0f6; margin:10px 0;" />

      <div class="factRow"><div class="factLabel muted"># Seasons</div><div class="factValue">${escapeHtml(v(show.seasons))}</div></div>
      <div class="factRow"><div class="factLabel muted"># Episodes</div><div class="factValue">${escapeHtml(v(show.episodes))}</div></div>
      <div class="factRow"><div class="factLabel muted">Episode length</div><div class="factValue">${escapeHtml(v(show.episode_length_min))}</div></div>

      <div class="factRow"><div class="factLabel muted"># Movies</div><div class="factValue">${escapeHtml(v(show.movies))}</div></div>
      <div class="factRow"><div class="factLabel muted">Movie length</div><div class="factValue">${escapeHtml(v(show.movie_length_min))}</div></div>

      <div class="factRow"><div class="factLabel muted"># OVAs</div><div class="factValue">${escapeHtml(v(show.ovas))}</div></div>
      <div class="factRow"><div class="factLabel muted">OVA length</div><div class="factValue">${escapeHtml(v(show.ova_length_min))}</div></div>
    `;
    return;
  }

  // EDIT MODE
  desc.innerHTML = `
    <label class="field">
      <span>Description</span>
      <textarea id="edit_description" rows="4">${escapeHtml(show.description ?? "")}</textarea>
    </label>
  `;

  notes.innerHTML = `
    <label class="field">
      <span>Notes</span>
      <textarea id="edit_notes" rows="4">${escapeHtml(show.notes ?? "")}</textarea>
    </label>
  `;

  facts.innerHTML = `
    <div class="grid">

      ${selectRow("Status", "edit_status", [
        { value: "To Be Watched", label: "To Be Watched" },
        { value: "Watching", label: "Watching" },
        { value: "Watched", label: "Watched" },
        { value: "Dropped", label: "Dropped" },
        { value: "Waiting for Next Season", label: "Waiting for Next Season" }
      ], show.status)}

      ${selectRow("Ongoing", "edit_ongoing", [
        { value: "", label: "—" },
        { value: "Yes", label: "Yes" },
        { value: "No", label: "No" },
        { value: "On Hiatus", label: "On Hiatus" },
        { value: "To Be Released", label: "To Be Released" }
      ], show.ongoing ?? "")}

      ${selectRow("Type", "edit_show_type", [
        { value: "", label: "—" },
        { value: "TV", label: "TV" },
        { value: "Movie", label: "Movie" },
        { value: "TV & Movie", label: "TV & Movie" }
      ], show.show_type ?? "")}

      ${dateRow("Release date", "edit_release_date", show.release_date ?? "")}
      ${dateRow("Last watched", "edit_last_watched", show.last_watched ?? "")}
      ${numberRow("Rating (0–5)", "edit_rating_stars", show.rating_stars ?? "", 0)}

      <div id="editProgressBlock" style="grid-column:1/-1; display:none;">
        ${numberRow("Current season", "edit_current_season", show.current_season ?? "", 1)}
        ${numberRow("Current episode", "edit_current_episode", show.current_episode ?? "", 1)}
      </div>

      <div id="editTvBlock" style="grid-column:1/-1; display:none;" class="progressBlock">
        ${numberRow("# Seasons", "edit_seasons", show.seasons ?? "", 0)}
        ${numberRow("# Episodes", "edit_episodes", show.episodes ?? "", 0)}
        ${numberRow("Episode length (min)", "edit_episode_length_min", show.episode_length_min ?? "", 0)}
      </div>

      <div id="editMovieBlock" style="grid-column:1/-1; display:none;" class="progressBlock">
        ${numberRow("# Movies", "edit_movies", show.movies ?? "", 0)}
        ${numberRow("Movie length (min)", "edit_movie_length_min", show.movie_length_min ?? "", 0)}
      </div>

      <div id="editOvaBlock" style="grid-column:1/-1; display:none;" class="progressBlock">
        ${numberRow("# OVAs", "edit_ovas", show.ovas ?? "", 0)}
        ${numberRow("OVA length (min)", "edit_ova_length_min", show.ova_length_min ?? "", 0)}
      </div>
  <!-- ✅ TAG EDITING -->
    <div class="card innerCard" style="grid-column:1/-1; margin-top:10px;">
      <h4 style="margin:0 0 10px 0;">Edit Tags</h4>

      <div class="multiselect">
        <label>Studios</label>
        <button type="button" id="editStudioBtn" class="secondary">Select studios</button>
        <div id="editStudioMenu" class="menu hidden"></div>
        <div id="editStudioChips" class="chips"></div>
      </div>

      <div class="multiselect">
        <label>Platforms</label>
        <button type="button" id="editPlatformBtn" class="secondary">Select platforms</button>
        <div id="editPlatformMenu" class="menu hidden"></div>
        <div id="editPlatformChips" class="chips"></div>
      </div>

      <div class="multiselect">
        <label>Genres</label>
        <button type="button" id="editGenreBtn" class="secondary">Select genres</button>
        <div id="editGenreMenu" class="menu hidden"></div>
        <div id="editGenreChips" class="chips"></div>
      </div>

      <div class="multiselect">
        <label>Tropes</label>
        <button type="button" id="editTropeBtn" class="secondary">Select tropes</button>
        <div id="editTropeMenu" class="menu hidden"></div>
        <div id="editTropeChips" class="chips"></div>
      </div>
    </div>
    </div>
  `;


  // wire conditional visibility
  const statusSel = el("edit_status");
  const typeSel = el("edit_show_type");

  function syncEditVisibility() {
    const status = statusSel?.value || "";
    const type = typeSel?.value || "";
    const isWatching = status === "Watching";

    const isTV = type === "TV" || type === "TV & Movie";
    const isMovie = type === "Movie" || type === "TV & Movie";
    const isAnime = (show.category === "Anime");

    const prog = el("editProgressBlock");
    const tv = el("editTvBlock");
    const mv = el("editMovieBlock");
    const ova = el("editOvaBlock");

    if (prog) prog.style.display = isWatching ? "grid" : "none";
    if (tv) tv.style.display = isTV ? "grid" : "none";
    if (mv) mv.style.display = isMovie ? "grid" : "none";
    if (ova) ova.style.display = isAnime ? "grid" : "none";
  }

  statusSel?.addEventListener("change", syncEditVisibility);
  typeSel?.addEventListener("change", syncEditVisibility);
  syncEditVisibility();
 // --- build edit multiselects
window.EDIT_TAG_SELECTS = {
  studios: setupDbMultiSelect({ buttonId:"editStudioBtn", menuId:"editStudioMenu", chipsId:"editStudioChips", tableName:"studios" }),
  platforms: setupDbMultiSelect({ buttonId:"editPlatformBtn", menuId:"editPlatformMenu", chipsId:"editPlatformChips", tableName:"platforms" }),
  genres: setupDbMultiSelect({ buttonId:"editGenreBtn", menuId:"editGenreMenu", chipsId:"editGenreChips", tableName:"genres" }),
  tropes: setupDbMultiSelect({ buttonId:"editTropeBtn", menuId:"editTropeMenu", chipsId:"editTropeChips", tableName:"tropes" })
};

// load option lists (from cached globals)
window.EDIT_TAG_SELECTS.studios.setRows(STUDIO_ROWS);
window.EDIT_TAG_SELECTS.platforms.setRows(PLATFORM_ROWS);
window.EDIT_TAG_SELECTS.genres.setRows(GENRE_ROWS);
window.EDIT_TAG_SELECTS.tropes.setRows(TROPE_ROWS);

// preselect current show tags (requires your joins include ids)
const curStudios = (show.show_studios || []).map(x => x.studios).filter(Boolean);
const curPlatforms = (show.show_platforms || []).map(x => x.platforms).filter(Boolean);
const curGenres = (show.show_genres || []).map(x => x.genres).filter(Boolean);
const curTropes = (show.show_tropes || []).map(x => x.tropes).filter(Boolean);

window.EDIT_TAG_SELECTS.studios.setSelectedRows(curStudios);
window.EDIT_TAG_SELECTS.platforms.setSelectedRows(curPlatforms);
window.EDIT_TAG_SELECTS.genres.setSelectedRows(curGenres);
window.EDIT_TAG_SELECTS.tropes.setSelectedRows(curTropes);

}
async function replaceJoinRows({ joinTable, user_id, show_id, fkColumn, ids }) {
  // delete existing
  const del = await supabase
    .from(joinTable)
    .delete()
    .eq("user_id", user_id)
    .eq("show_id", show_id);

  if (del.error) throw new Error(`Delete ${joinTable}: ${del.error.message}`);

  // insert new
  if (!ids || !ids.length) return;

  const rows = ids.map(id => ({
    user_id,
    show_id,
    [fkColumn]: id
  }));

  const ins = await supabase.from(joinTable).insert(rows);
  if (ins.error) throw new Error(`Insert ${joinTable}: ${ins.error.message}`);
}

function setInlineEditMode(on) {
  EDIT_MODE = on;

  const editBtn = el("inlineEditBtn");
  const saveBtn = el("inlineSaveBtn");
  const cancelBtn = el("inlineCancelBtn");

  if (editBtn) editBtn.style.display = on ? "none" : "";
  if (saveBtn) saveBtn.style.display = on ? "" : "none";
  if (cancelBtn) cancelBtn.style.display = on ? "" : "none";

  if (CURRENT_SHOW) renderShowDetailBlocks(CURRENT_SHOW, on ? "edit" : "view");
}

async function saveInlineEdits() {
  if (!CURRENT_SHOW?.id) return;

  const msgEl = el("showDetailMsg");
  if (msgEl) msgEl.textContent = "Saving…";

  const payload = {
    status: el("edit_status")?.value || CURRENT_SHOW.status,
    ongoing: (el("edit_ongoing")?.value || null),
    show_type: (el("edit_show_type")?.value || null),

    release_date: el("edit_release_date")?.value || null,
    last_watched: el("edit_last_watched")?.value || null,

    rating_stars: toIntOrNull(el("edit_rating_stars")?.value),

    current_season: toIntOrNull(el("edit_current_season")?.value),
    current_episode: toIntOrNull(el("edit_current_episode")?.value),

    seasons: toIntOrNull(el("edit_seasons")?.value),
    episodes: toIntOrNull(el("edit_episodes")?.value),
    episode_length_min: toIntOrNull(el("edit_episode_length_min")?.value),

    movies: toIntOrNull(el("edit_movies")?.value),
    movie_length_min: toIntOrNull(el("edit_movie_length_min")?.value),

    // only for anime; otherwise store nulls
    ovas: (CURRENT_SHOW.category === "Anime") ? toIntOrNull(el("edit_ovas")?.value) : null,
    ova_length_min: (CURRENT_SHOW.category === "Anime") ? toIntOrNull(el("edit_ova_length_min")?.value) : null,

    description: el("edit_description")?.value?.trim() || null,
    notes: el("edit_notes")?.value?.trim() || null
  };

  const { error } = await supabase
    .from("shows")
    .update(payload)
    .eq("id", CURRENT_SHOW.id);
const user_id = await getUserId();

const sels = window.EDIT_TAG_SELECTS;
if (sels && user_id) {
  await replaceJoinRows({ joinTable:"show_studios", user_id, show_id: CURRENT_SHOW.id, fkColumn:"studio_id", ids: sels.studios.getIds() });
  await replaceJoinRows({ joinTable:"show_platforms", user_id, show_id: CURRENT_SHOW.id, fkColumn:"platform_id", ids: sels.platforms.getIds() });
  await replaceJoinRows({ joinTable:"show_genres", user_id, show_id: CURRENT_SHOW.id, fkColumn:"genre_id", ids: sels.genres.getIds() });
  await replaceJoinRows({ joinTable:"show_tropes", user_id, show_id: CURRENT_SHOW.id, fkColumn:"trope_id", ids: sels.tropes.getIds() });
}

  if (error) {
    if (msgEl) msgEl.textContent = `Error: ${error.message}`;
    return;
  }

  if (msgEl) msgEl.textContent = "Saved!";
  setInlineEditMode(false);

  await loadShowDetail(CURRENT_SHOW.id);
 console.log("SHOW DETAIL DATA:", data);

  await loadShows(); // keep Collection/Browse updated
}

// -------------------
// Poster Cards (fixed for your schema)
// -------------------
const FALLBACK_POSTER = "./assets/poster-placeholder.png";

function getPosterUrl(item) {
  // You store this as image_url in DB
  const s = String(item?.image_url ?? "").trim();
  return s ? s : FALLBACK_POSTER;
}

// Clickable poster card template
function collectionCardHTML(r) {
  const poster = getPosterUrl(r);

  const title = r.title || "Untitled";
  const cat = r.category || "";
  const type = r.show_type || "";
  const status = r.status || "";
  const ongoing = r.ongoing || "";
  const rating = r.rating_stars ? starsDisplay(r.rating_stars) : "";

  // Optional progress for Watching
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

        <div class="media-actions">
          <button class="btn small" type="button" data-action="open">Open</button>
        </div>
      </div>
    </article>
  `;
}

/**
 * IMPORTANT: make renderCollection take NO args,
 * because your app calls renderCollection() in loadShows().
 * It pulls rows from your existing getCollectionRows().
 */
function renderCollection() {
  const wrap = el("collectionList");     // keep your existing container
  const note = el("collectionMsg");
  if (!wrap) return;

  const rows = getCollectionRows();

  if (!rows.length) {
    wrap.innerHTML = "";
    if (note) note.textContent = "No items yet (try switching filters or add a show).";
    return;
  }
  if (note) note.textContent = "";

  wrap.innerHTML = rows.map(collectionCardHTML).join("");
}

// ✅ Attach ONE click handler (event delegation) ONCE
function wireCollectionClicks() {
  const wrap = el("collectionList");
  if (!wrap) return;

  wrap.addEventListener("click", (e) => {
    const openBtn = e.target.closest("button[data-action='open']");
    const card = e.target.closest(".media-card");
    const target = openBtn || card;
    if (!target) return;

    const id = card?.dataset?.id;
    if (!id) return;

    window.location.hash = `#show?id=${id}`;
    route();
  });

  // Optional: keyboard open
  wrap.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".media-card");
    if (!card) return;
    e.preventDefault();
    const id = card.dataset.id;
    window.location.hash = `#show?id=${id}`;
    route();
  });
}


// --------------------
// Browse filter helpers
// --------------------
function fillSelect(selectId, rows, label) {
  const sel = el(selectId);
  if (!sel) return;

  // preserve existing selected values (works for multiple + single)
  const prev = new Set(Array.from(sel.selectedOptions || []).map(o => o.value));

  // For multiple selects, you usually DON'T want the "All ..." option.
  const isMulti = sel.hasAttribute("multiple");

  sel.innerHTML =
    (isMulti ? "" : `<option value="">All ${label}</option>`) +
    (rows || [])
      .map(r => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`)
      .join("");

  // restore selections
  Array.from(sel.options).forEach(opt => {
    if (prev.has(opt.value)) opt.selected = true;
  });
}

function rowHasName(list, key, wanted) {
  if (!wanted) return true;
  return (list || []).some(x => x?.[key]?.name === wanted);
}

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

    // Status: match ANY selected
    if (statuses.length && !statuses.includes(r.status)) return false;

    // Min rating
    if (minRating != null) {
      const rs = r.rating_stars == null ? 0 : Number(r.rating_stars);
      if (rs < minRating) return false;
    }

    // Platforms: match ANY selected
    if (platformsWanted.length) {
      const rowPlatforms = (r.show_platforms || []).map(x => x.platforms?.name).filter(Boolean);
      if (!platformsWanted.some(p => rowPlatforms.includes(p))) return false;
    }

    // Genres: match ANY selected
    if (genresWanted.length) {
      const rowGenres = (r.show_genres || []).map(x => x.genres?.name).filter(Boolean);
      if (!genresWanted.some(g => rowGenres.includes(g))) return false;
    }

    // Tropes: match ANY selected
    if (tropesWanted.length) {
      const rowTropes = (r.show_tropes || []).map(x => x.tropes?.name).filter(Boolean);
      if (!tropesWanted.some(t => rowTropes.includes(t))) return false;
    }

    // Studios: match ANY selected
    if (studiosWanted.length) {
      const rowStudios = (r.show_studios || []).map(x => x.studios?.name).filter(Boolean);
      if (!studiosWanted.some(s => rowStudios.includes(s))) return false;
    }

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
    },
    setSelectedRows: (rows) => {
    selected.clear();
    (rows || []).forEach(r => selected.set(r.id, r.name));
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
    } else if (sort === "release_newest" || sort === "release_oldest") {
  rows.sort((a, b) => {
    const ad = a.release_date ? Date.parse(a.release_date) : (sort === "release_oldest" ? Infinity : -Infinity);
    const bd = b.release_date ? Date.parse(b.release_date) : (sort === "release_oldest" ? Infinity : -Infinity);
    return (sort === "release_oldest") ? (ad - bd) : (bd - ad);
  });
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

// function renderCollection() {
//   const wrap = el("collectionList");
//   const note = el("collectionMsg");
//   if (!wrap) return;

//   const rows = getCollectionRows();

//   if (!rows.length) {
//     wrap.innerHTML = "";
//     if (note) note.textContent = "No items yet (try switching filters or add a show).";
//     return;
//   }

//   if (note) note.textContent = "";

//   wrap.innerHTML = rows.map(r => {
//     const platforms = (r.show_platforms || []).map(x => x.platforms?.name).filter(Boolean);
//     const genres = (r.show_genres || []).map(x => x.genres?.name).filter(Boolean);
//     const tropes = (r.show_tropes || []).map(x => x.tropes?.name).filter(Boolean);
//   const studios = (r.show_studios || []).map(x => x.studios?.name).filter(Boolean);
//     const progress =
//       r.status === "Watching" && (r.current_season || r.current_episode)
//         ? `S${r.current_season || "?"} · E${r.current_episode || "?"}`
//         : "";

//     return `
//       <div class="card" style="margin: 10px 0;">
//         <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
//           <div>
//             <div style="font-weight:700; font-size:16px;">${escapeHtml(r.title)}</div>
//             <div class="muted" style="margin-top:4px;">
//               ${escapeHtml(r.category || "")}${r.show_type ? " • " + escapeHtml(r.show_type) : ""}
//               ${r.ongoing ? " • " + escapeHtml(r.ongoing) : ""}
//             </div>
//           </div>

//           <div style="text-align:right;">
//             <div style="font-weight:600;">${escapeHtml(r.status || "")}</div>
//             <div class="muted">${escapeHtml(starsDisplay(r.rating_stars))}</div>
//             ${progress ? `<div class="muted" style="margin-top:4px;">${escapeHtml(progress)}</div>` : ""}
//           </div>
//         </div>

//         <div class="muted" style="margin-top:10px; display:grid; gap:6px;">
//           ${platforms.length ? `<div><b>Where:</b> ${escapeHtml(platforms.join(", "))}</div>` : ""}
//           ${genres.length ? `<div><b>Genres:</b> ${escapeHtml(genres.join(", "))}</div>` : ""}
//           ${tropes.length ? `<div><b>Tropes:</b> ${escapeHtml(tropes.join(", "))}</div>` : ""}
//           ${studios.length ? `<div><b>Studios:</b> ${escapeHtml(studios.join(", "))}</div>` : ""}
//           ${r.last_watched ? `<div><b>Last watched:</b> ${escapeHtml(r.last_watched)}</div>` : ""}
//         </div>
//       </div>
//     `;
//   }).join("");
// }


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
current_episode,
         description,
    image_url
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
       id, user_id, title, status, rating_stars, last_watched, created_at,
    category, show_type, ongoing, release_date, rewatch_count,
is_rewatching,
last_rewatch_date,     description,
    image_url,
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
    msg.textContent = `Error: ${error.message}`;
    return;
  }


  ALL_SHOWS_CACHE = data || [];
  rerenderFiltered();
  updateHomeCounts();
 renderCollection();
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
      <td>${escapeHtml(studios.join(", "))}</td>
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
  const factsEl = el("showFacts");
  const tagsEl = el("showTags");
  const msgEl = el("showDetailMsg");

  if (msgEl) msgEl.textContent = "Loading…";

  // (Optional but recommended) lock to current user too
  const user_id = await getUserId();

  const { data, error } = await supabase
    .from("shows")
    .select(`
      id, user_id, title, status, rating_stars, last_watched, created_at,
      category, show_type, ongoing, release_date,
      seasons, episodes, episode_length_min, rewatch_count,
is_rewatching,
last_rewatch_date,
    notes,
    description,
    image_url,
    mal_id,
      movies, movie_length_min,
      ovas, ova_length_min,
      current_season, current_episode,
   show_platforms(platform_id, platforms(id, name)),
show_genres(genre_id, genres(id, name)),
show_tropes(trope_id, tropes(id, name)),
show_studios(studio_id, studios(id, name))
    `)
    .eq("id", showId)
    .eq("user_id", user_id)   // prevents seeing other users’ rows + helps RLS consistency
    .single();

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
renderShowDetailBlocks(CURRENT_SHOW, EDIT_MODE ? "edit" : "view");
}

function setEditMode(on) {
  const form = el("editForm");
  const editBtn = el("editShowBtn");
  const saveBtn = el("saveShowBtn");
  const cancelBtn = el("cancelShowBtn");

  if (form) form.style.display = on ? "" : "none";
  if (editBtn) editBtn.style.display = on ? "none" : "";
  if (saveBtn) saveBtn.style.display = on ? "" : "none";
  if (cancelBtn) cancelBtn.style.display = on ? "" : "none";
}

function fillEditForm(show) {
  if (!show) return;

  const setVal = (id, v) => { const n = el(id); if (n) n.value = (v ?? ""); };

  setVal("edit_status", show.status);
  setVal("edit_rating", show.rating_stars ?? "");
  setVal("edit_last_watched", show.last_watched ?? "");
  setVal("edit_current_season", show.current_season ?? "");
  setVal("edit_current_episode", show.current_episode ?? "");
  setVal("edit_description", show.description ?? "");
  setVal("edit_notes", show.notes ?? "");

  setVal("edit_rewatch_count", show.rewatch_count ?? 0);
  const rw = el("edit_is_rewatching");
  if (rw) rw.value = String(!!show.is_rewatching);

  setVal("edit_last_rewatch_date", show.last_rewatch_date ?? "");
}

function toIntOrNull2(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

async function saveShowEdits() {
  if (!CURRENT_SHOW?.id) return;

  const editMsg = el("editMsg");
  if (editMsg) editMsg.textContent = "Saving…";

  const payload = {
    status: el("edit_status")?.value || CURRENT_SHOW.status,
    rating_stars: toIntOrNull2(el("edit_rating")?.value),
    last_watched: el("edit_last_watched")?.value || null,
    current_season: toIntOrNull2(el("edit_current_season")?.value),
    current_episode: toIntOrNull2(el("edit_current_episode")?.value),
    description: el("edit_description")?.value?.trim() || null,
    notes: el("edit_notes")?.value?.trim() || null,

    rewatch_count: toIntOrNull2(el("edit_rewatch_count")?.value) ?? 0,
    is_rewatching: (el("edit_is_rewatching")?.value === "true"),
    last_rewatch_date: el("edit_last_rewatch_date")?.value || null
  };

  const { error } = await supabase
    .from("shows")
    .update(payload)
    .eq("id", CURRENT_SHOW.id);

  if (error) {
    if (editMsg) editMsg.textContent = `Error: ${error.message}`;
    return;
  }

  if (editMsg) editMsg.textContent = "Saved!";
  setEditMode(false);

  // Reload detail + cache list so Collection/Browse stay consistent
  await loadShowDetail(CURRENT_SHOW.id);
  await loadShows();
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

console.log("studio elements:", !!el("studioBtn"), !!el("studioMenu"), !!el("studioChips"));

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
el("q")?.addEventListener("input", rerender);
 // .forEach(id => {
 //      const node = el(id);
 //      if (!node) return;
 //      const evt = (id === "q" || id === "studioFilter") ? "input" : "change";
 //      node.addEventListener(evt, rerender);
 //    });

el("clearFilters")?.addEventListener("click", () => {
  if (el("q")) el("q").value = "";

  clearCheckboxGroup("statusFilter");
  clearCheckboxGroup("platformFilter");
  clearCheckboxGroup("genreFilter");
  clearCheckboxGroup("tropeFilter");
  clearCheckboxGroup("studioFilter");

  // reset min rating radio to Any
  const any = document.querySelector('input[type="radio"][name="minRatingFilter"][value=""]');
  if (any) any.checked = true;

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
 wireBrowseFilterDrawer();
  window.addEventListener("hashchange", route);
  wireCollectionClicks();
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
// el("collectionGroup")?.addEventListener("change", renderCollectionCards);
 el("editShowBtn")?.addEventListener("click", () => {
  fillEditForm(CURRENT_SHOW);
  setEditMode(true);
});
el("inlineEditBtn")?.addEventListener("click", () => setInlineEditMode(true));
 el("inlineCancelBtn")?.addEventListener("click", () => setInlineEditMode(false));
el("inlineSaveBtn")?.addEventListener("click", saveInlineEdits);
el("cancelShowBtn")?.addEventListener("click", () => {
  setEditMode(false);
  const editMsg = el("editMsg");
  if (editMsg) editMsg.textContent = "";
});
el("fetchAnimeBtn")?.addEventListener("click", async () => {
  if (!CURRENT_SHOW?.id) return;

  const msgEl = el("showDetailMsg");
  if (msgEl) msgEl.textContent = "Fetching anime info…";

  try {
    const info = await fetchAnimeFromJikan(CURRENT_SHOW.title);
    if (!info) {
      if (msgEl) msgEl.textContent = "No match found.";
      return;
    }

    // Decide whether to overwrite description or only fill if empty:
    const payload = {
      mal_id: info.mal_id,
      image_url: info.image_url
    };

    // only fill description if you don’t already have one
    if (!CURRENT_SHOW.description?.trim()) payload.description = info.description;

    const { error } = await supabase
      .from("shows")
      .update(payload)
      .eq("id", CURRENT_SHOW.id);

    if (error) {
      if (msgEl) msgEl.textContent = `Error: ${error.message}`;
      return;
    }

    if (msgEl) msgEl.textContent = "Fetched!";
    await loadShowDetail(CURRENT_SHOW.id);
    await loadShows();
  } catch (e) {
    if (msgEl) msgEl.textContent = `Error: ${e.message}`;
  }
});

el("saveShowBtn")?.addEventListener("click", saveShowEdits);

el("collectionSort")?.addEventListener("change", renderCollection);
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
PLATFORM_ROWS = p;
GENRE_ROWS = g;
TROPE_ROWS = t;
STUDIO_ROWS = s;

  platformSelect.setRows(p);
  genreSelect.setRows(g);
  tropeSelect.setRows(t);
studioSelect.setRows(s);
  fillSelect("platformFilter", p, "platforms");
  fillSelect("genreFilter", g, "genres");
  fillSelect("tropeFilter", t, "tropes");
function buildBrowseFiltersUI() {
  // Status is not from a lookup table, so hardcode your known statuses
  const STATUS_ITEMS = [
    "To Be Watched",
    "Watching",
    "Waiting for Next Season",
    "Watched",
    "Dropped"
  ];

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

  // Min rating: I'd recommend RADIO (single choice) instead of checkboxes
  buildMinRatingRadios();
}

function buildMinRatingRadios() {
  const box = el("minRatingBox");
  if (!box) return;

  const opts = ["", "1", "2", "3", "4", "5"]; // "" = Any
  box.innerHTML = opts.map(v => `
    <label class="checkboxRow">
      <input type="radio" name="minRatingFilter" value="${v}" ${v === "" ? "checked" : ""}/>
      <span>${v === "" ? "Any" : `${v}+`}</span>
    </label>
  `).join("");

  box.querySelectorAll('input[type="radio"][name="minRatingFilter"]').forEach(r => {
    r.addEventListener("change", rerenderFiltered);
  });
}

  await loadShows();       // fills ALL_SHOWS_CACHE
  updateHomeCounts();      // (you’ll add this below)
 buildBrowseFiltersUI();  
renderCollection();
}

supabase.auth.onAuthStateChange(async (_event, session2) => {
  showAuthedUI(!!session2);
  if (authMsg) authMsg.textContent = session2 ? "Logged in." : "Logged out.";

  if (!session2) return;

const [p, g, t, s] = await Promise.all([
  loadOptionRows("platforms"),
  loadOptionRows("genres"),
  loadOptionRows("tropes"),
  loadOptionRows("studios")
]);
PLATFORM_ROWS = p;
GENRE_ROWS = g;
TROPE_ROWS = t;
STUDIO_ROWS = s;

  platformSelect.setRows(p);
  genreSelect.setRows(g);
  tropeSelect.setRows(t);
 studioSelect.setRows(s);

function buildBrowseFiltersUI() {
  // Status is not from a lookup table, so hardcode your known statuses
  const STATUS_ITEMS = [
    "To Be Watched",
    "Watching",
    "Waiting for Next Season",
    "Watched",
    "Dropped"
  ];

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

  // Min rating: I'd recommend RADIO (single choice) instead of checkboxes
  buildMinRatingRadios();
}

function buildMinRatingRadios() {
  const box = el("minRatingBox");
  if (!box) return;

  const opts = ["", "1", "2", "3", "4", "5"]; // "" = Any
  box.innerHTML = opts.map(v => `
    <label class="checkboxRow">
      <input type="radio" name="minRatingFilter" value="${v}" ${v === "" ? "checked" : ""}/>
      <span>${v === "" ? "Any" : `${v}+`}</span>
    </label>
  `).join("");

  box.querySelectorAll('input[type="radio"][name="minRatingFilter"]').forEach(r => {
    r.addEventListener("change", rerenderFiltered);
  });
}

  fillSelect("platformFilter", p, "platforms");
  fillSelect("genreFilter", g, "genres");
  fillSelect("tropeFilter", t, "tropes");
buildBrowseFiltersUI();  
  await loadShows();
  updateHomeCounts();


});

}

init();
