import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const el = (id) => document.getElementById(id);

const authMsg = el("authMsg");
const msg = el("msg");
const appSection = el("app");
const listCard = el("listCard");
const logoutBtn = el("logout");

function csvToArray(s) {
  return String(s || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
}

function arrayToText(arr) {
  return (arr || []).join(", ");
}

function showAuthedUI(isAuthed) {
  appSection.style.display = isAuthed ? "" : "none";
  listCard.style.display = isAuthed ? "" : "none";
  logoutBtn.style.display = isAuthed ? "" : "none";
}

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

async function loadShows() {
  msg.textContent = "Loading…";
  const q = el("q").value.trim();
  const status = el("statusFilter").value;

  let query = supabase
    .from("shows")
    .select("*")
    .order("created_at", { ascending: false });

  if (q) query = query.ilike("title", `%${q}%`);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    msg.textContent = `Error: ${error.message}`;
    return;
  }

  renderTable(data);
  msg.textContent = data.length ? "" : "No results.";
}

function renderTable(rows) {
  const tbody = el("table").querySelector("tbody");
  tbody.innerHTML = "";

  for (const r of rows) {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${escapeHtml(r.title)}</td>
      <td>${escapeHtml(r.status)}</td>
      <td>${r.my_rating ?? ""}</td>
      <td>${escapeHtml(arrayToText(r.platforms))}</td>
      <td>${escapeHtml(arrayToText(r.genres))}</td>
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

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function addShow(formData) {
  const user_id = await getUserId();
  if (!user_id) {
    msg.textContent = "You must be logged in.";
    return;
  }

  const title = formData.get("title").trim();
  const status = formData.get("status");
  const my_rating_raw = formData.get("my_rating");
  const my_rating = my_rating_raw ? Number(my_rating_raw) : null;

  const studio = formData.get("studio").trim() || null;
  const platforms = csvToArray(formData.get("platforms"));
  const genres = csvToArray(formData.get("genres"));
  const notes = formData.get("notes").trim() || null;

  // Optional: if status is To Be Watched, keep last_watched null
  // If status is Watched, set last_watched today
  let last_watched = null;
  if (status === "Watched") {
    const d = new Date();
    d.setHours(0,0,0,0);
    last_watched = d.toISOString().slice(0,10); // YYYY-MM-DD
  }

  const { error } = await supabase.from("shows").insert([{
    user_id, title, status, my_rating, studio, platforms, genres, notes, last_watched
  }]);

  msg.textContent = error ? `Error: ${error.message}` : "Added!";
}

async function deleteShow(id) {
  const { error } = await supabase.from("shows").delete().eq("id", id);
  if (error) msg.textContent = `Error: ${error.message}`;
}

async function init() {
  // Hook up UI
  el("sendLink").addEventListener("click", () => {
    const email = el("email").value.trim();
    if (!email) return;
    sendMagicLink(email);
  });

  logoutBtn.addEventListener("click", logout);

  el("addForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await addShow(new FormData(e.target));
    e.target.reset();
    await loadShows();
  });

  el("refresh").addEventListener("click", loadShows);
  el("q").addEventListener("input", debounce(loadShows, 250));
  el("statusFilter").addEventListener("change", loadShows);

  // Auth state
  const { data: { session } } = await supabase.auth.getSession();
  showAuthedUI(!!session);
  if (session) await loadShows();

  supabase.auth.onAuthStateChange(async (_event, session2) => {
    showAuthedUI(!!session2);
    authMsg.textContent = session2 ? "Logged in." : "Logged out.";
    if (session2) await loadShows();
  });
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

init();

