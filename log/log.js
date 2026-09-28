// GATE is sha256 of the passphrase. Rotate the hash; do not write the phrase here.
const GATE = "aa2f27c9fc8e897a43af876b8050c834b77c2379356f746c1f272c09e73658a8";
const STORE = "pilgrimage-log";
const OPEN_KEY = "pilgrimage-log-open";
const KEEP_KEY = "pilgrimage-log-keep";
const PHRASE_KEY = "pilgrimage-log-phrase";
const TOKEN_KEY = "pilgrimage-log-gh";
const THEME_KEY = "pilgrimage-theme";
const GH_API = "https://api.github.com/repos/colorlesspilgrimage/colorlesspilgrimage.github.io/contents/log/vault.json";
const KDF_ITERS = 210000;
const THEMES = ["darcula", "day", "string", "number", "function", "select"];
const STATUSES = ["playing", "to-play", "played"];
const STATUS_LABEL = { playing: "playing", "to-play": "to play", played: "played" };
const LONG_SESSION = 6 * 60 * 60 * 1000;

const state = load();
let filter = "all";
let find = "";
let dropId = null;
let editingTimeId = null;
let editingTitleId = null;
let pendingEndId = null;
let focusTitle = false;
let focusTime = false;
let titleCommit = false;
const lookupGen = new Map();
const probeCache = new Map();
let phrase = "";
let remoteSha = "";
let sawRemote = false;
let pushTimer = 0;
let pushing = false;
let pushTries = 0;
let suspendPush = false;

function $(id) { return document.getElementById(id); }

function esc(value) {
  return String(value)
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;")
    .replace(/'/g, "\u0026#39;");
}

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:") return "";
    return url.href;
  } catch (e) {
    return "";
  }
}

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function normalize(value) {
  return String(value)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function scoreTitle(query, name) {
  const q = normalize(query);
  const n = normalize(name);
  if (!q || !n) return 0;
  if (q === n) return 100;
  const qTokens = q.split(" ");
  const nTokens = n.split(" ");
  if (qTokens.every((token, index) => nTokens[index] === token)) {
    return Math.max(40, 90 - (nTokens.length - qTokens.length) * 14);
  }
  if (n.startsWith(q)) return 86;
  if (n.includes(q)) return 68;
  let overlap = 0;
  for (const token of qTokens) if (nTokens.includes(token)) overlap += 1;
  return Math.round((overlap / qTokens.length) * 48);
}

function initials(title) {
  const parts = title.trim().split(/\s+/).slice(0, 2);
  const text = parts.map((part) => part[0] || "").join("").toUpperCase();
  return text || "·";
}

function formatPlayed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total === 0) return "0m";
  if (total < 60) return total + "s";
  const minutes = Math.floor(total / 60);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) return mins + "m";
  return hours + "h " + String(mins).padStart(2, "0") + "m";
}

function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((n) => String(n).padStart(2, "0")).join(":");
}

function banked(entry) {
  return Math.max(0, Number(entry.playedMs) || 0);
}

function liveMs(entry, now) {
  if (!entry.sessionStart) return 0;
  return Math.max(0, now - entry.sessionStart);
}

function totalBanked() {
  return state.entries.reduce((sum, entry) => sum + banked(entry), 0);
}

function cleanEntry(raw) {
  if (!raw || typeof raw.title !== "string") return null;
  const title = raw.title.trim().replace(/\s+/g, " ").slice(0, 180);
  if (!title) return null;
  const status = STATUSES.includes(raw.status) ? raw.status : "to-play";
  const playedMs = Number(raw.playedMs);
  const sessionStart = Number(raw.sessionStart);
  const alts = Array.isArray(raw.alts)
    ? raw.alts
        .map((alt) => ({
          url: safeUrl(alt && alt.url),
          label: String((alt && alt.label) || title).slice(0, 180),
        }))
        .filter((alt) => alt.url)
        .slice(0, 6)
    : [];
  return {
    id: typeof raw.id === "string" && raw.id.length < 80 ? raw.id : uid(),
    title,
    status,
    playedMs: Number.isFinite(playedMs) && playedMs > 0 ? Math.min(playedMs, 1e12) : 0,
    sessionStart: Number.isFinite(sessionStart) && sessionStart > 0 ? sessionStart : null,
    cover: safeUrl(raw.cover),
    alts,
    looking: false,
    artMiss: raw.artMiss === true && !safeUrl(raw.cover),
    touchedAt: Number(raw.touchedAt) || Date.now(),
    addedAt: Number(raw.addedAt) || Date.now(),
  };
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || "null");
    const entries = raw && Array.isArray(raw.entries) ? raw.entries.map(cleanEntry).filter(Boolean) : [];
    const dropped = raw && Array.isArray(raw.dropped) ? cleanDropped(raw.dropped) : [];
    return { entries, dropped, updatedAt: Number(raw && raw.updatedAt) || 0 };
  } catch (e) {
    return { entries: [], dropped: [], updatedAt: 0 };
  }
}

function cleanDropped(list) {
  return list
    .filter((row) => row && typeof row.id === "string" && row.id.length < 80)
    .map((row) => ({ id: row.id, at: Number(row.at) || 0 }))
    .slice(-400);
}

function snapshot() {
  return {
    version: 1,
    updatedAt: state.updatedAt || 0,
    entries: state.entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      status: entry.status,
      playedMs: entry.playedMs,
      sessionStart: entry.sessionStart,
      cover: entry.cover,
      alts: entry.alts,
      artMiss: entry.artMiss === true,
      touchedAt: entry.touchedAt,
      addedAt: entry.addedAt,
    })),
    dropped: cleanDropped(state.dropped || []),
  };
}

function saveLocal() {
  localStorage.setItem(STORE, JSON.stringify(snapshot()));
}

function save() {
  state.updatedAt = Date.now();
  saveLocal();
  if (!suspendPush) schedulePush();
}

function entryById(id) {
  return state.entries.find((entry) => entry.id === id) || null;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hashesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bytesToB64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function b64ToBytes(value) {
  const bin = atob(String(value).replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function utf8ToB64(text) {
  return bytesToB64(new TextEncoder().encode(text));
}

async function deriveKey(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const rounds = Math.max(100000, Math.min(600000, Number(iterations) || KDF_ITERS));
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: rounds, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptVault(passphrase, obj) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, KDF_ITERS);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iter: KDF_ITERS,
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    data: bytesToB64(new Uint8Array(cipher)),
  };
}

async function decryptVault(passphrase, vault) {
  if (!vault || vault.v !== 1 || !vault.salt || !vault.iv || !vault.data) throw new Error("vault");
  const key = await deriveKey(passphrase, b64ToBytes(vault.salt), vault.iter);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(vault.iv) }, key, b64ToBytes(vault.data));
  const data = JSON.parse(new TextDecoder().decode(plain));
  if (!data || !Array.isArray(data.entries)) throw new Error("vault");
  return data;
}

function canon(data) {
  const entries = (data.entries || []).map((entry) => ({
    id: entry.id,
    title: entry.title,
    status: entry.status,
    playedMs: entry.playedMs,
    sessionStart: entry.sessionStart || null,
    cover: entry.cover || "",
    alts: (entry.alts || []).map((alt) => (alt && alt.url) || "").join("|"),
    artMiss: entry.artMiss === true,
    touchedAt: entry.touchedAt || 0,
    addedAt: entry.addedAt || 0,
  }));
  entries.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const dropped = cleanDropped(data.dropped || []).map((row) => row.id + "@" + row.at).sort();
  return JSON.stringify({ entries, dropped });
}

function mergeRemote(remote) {
  const dropped = cleanDropped([...(state.dropped || []), ...(remote.dropped || [])]);
  const dropAt = new Map();
  for (const row of dropped) {
    if (!dropAt.has(row.id) || row.at > dropAt.get(row.id)) dropAt.set(row.id, row.at);
  }
  const byId = new Map();
  const incoming = []
    .concat(remote.entries || [])
    .concat(state.entries)
    .map(cleanEntry)
    .filter(Boolean);
  for (const entry of incoming) {
    const prev = byId.get(entry.id);
    if (!prev || (entry.touchedAt || 0) >= (prev.touchedAt || 0)) byId.set(entry.id, entry);
  }
  const entries = [];
  for (const entry of byId.values()) {
    const gone = dropAt.get(entry.id);
    if (gone && gone >= (entry.touchedAt || 0)) continue;
    entries.push(entry);
  }
  state.entries = entries;
  state.dropped = [...dropAt.entries()].map(([id, at]) => ({ id, at })).slice(-400);
  state.updatedAt = Math.max(Number(state.updatedAt) || 0, Number(remote.updatedAt) || 0);
}

function ghHeaders() {
  return {
    Authorization: "Bearer " + token(),
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function token() {
  try {
    return (localStorage.getItem(TOKEN_KEY) || "").trim();
  } catch (e) {
    return "";
  }
}

function setSync(text) {
  const node = $("sync");
  if (node) node.textContent = text;
}

function paintSyncForm() {
  const linked = !!token();
  const input = $("gh-token");
  const help = $("token-help");
  const button = $("sync-form") && $("sync-form").querySelector("button");
  if (input) input.classList.toggle("is-off", linked);
  if (help) help.classList.toggle("is-off", linked);
  if (button) button.textContent = linked ? "unlink" : "link";
}

function schedulePush() {
  if (suspendPush || !phrase || !token() || !sawRemote) return;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => { pushVault(); }, 1200);
}

async function githubMeta() {
  const res = await fetch(GH_API, { headers: ghHeaders(), cache: "no-store" });
  if (res.status === 404) return { sha: "", json: null };
  if (!res.ok) throw new Error("read " + res.status);
  const meta = await res.json();
  const json = JSON.parse(new TextDecoder().decode(b64ToBytes(meta.content || "")));
  return { sha: meta.sha || "", json };
}

async function readRemote() {
  if (token()) return githubMeta();
  const res = await fetch("/log/vault.json?t=" + Date.now(), { cache: "no-store" });
  if (res.status === 404) return { sha: "", json: null };
  if (!res.ok) throw new Error("read " + res.status);
  return { sha: "", json: await res.json() };
}

async function pullVault() {
  if (!phrase) return;
  setSync(token() ? "server · reading" : "server · reading");
  let remote;
  try {
    remote = await readRemote();
  } catch (e) {
    setSync("server · offline");
    return;
  }
  sawRemote = true;
  remoteSha = remote.sha || "";
  if (!remote.json) {
    setSync(token() ? "server · empty" : "server · link a token");
    if (token() && state.entries.length) schedulePush();
    return;
  }
  let plain;
  try {
    plain = await decryptVault(phrase, remote.json);
  } catch (e) {
    setSync("server · locked");
    return;
  }
  suspendPush = true;
  mergeRemote(plain);
  saveLocal();
  suspendPush = false;
  render();
  if (canon(snapshot()) !== canon(plain)) {
    if (token()) schedulePush();
    else setSync("server · encrypted · link a token");
  } else {
    setSync(token() ? "server · saved" : "server · encrypted · link a token");
  }
}

async function pushVault() {
  if (!phrase || !token() || !sawRemote) return;
  if (pushing) return;
  pushing = true;
  setSync("server · writing");
  try {
    let meta = await githubMeta();
    if (meta.json) {
      try {
        const plain = await decryptVault(phrase, meta.json);
        if (canon(snapshot()) !== canon(plain)) {
          suspendPush = true;
          mergeRemote(plain);
          state.updatedAt = Date.now();
          saveLocal();
          suspendPush = false;
          render();
        }
        meta = { sha: meta.sha, json: meta.json };
      } catch (e) {
        setSync("server · locked");
        pushing = false;
        return;
      }
    }
    const vault = await encryptVault(phrase, snapshot());
    const res = await fetch(GH_API, {
      method: "PUT",
      headers: { ...ghHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Update encrypted log",
        content: utf8ToB64(JSON.stringify(vault)),
        branch: "main",
        sha: meta.sha || undefined,
      }),
    });
    if ((res.status === 409 || res.status === 422) && pushTries < 2) {
      pushTries += 1;
      pushing = false;
      schedulePush();
      return;
    }
    if (!res.ok) throw new Error("write " + res.status);
    const saved = await res.json();
    remoteSha = (saved.content && saved.content.sha) || remoteSha;
    pushTries = 0;
    setSync("server · saved");
  } catch (e) {
    setSync("server · not written");
  }
  pushing = false;
}

function rememberPhrase(text, keep) {
  phrase = text;
  try {
    sessionStorage.setItem(PHRASE_KEY, text);
    if (keep) localStorage.setItem(PHRASE_KEY, text);
    else localStorage.removeItem(PHRASE_KEY);
  } catch (e) {}
}

function forgetPhrase() {
  phrase = "";
  try {
    sessionStorage.removeItem(PHRASE_KEY);
    localStorage.removeItem(PHRASE_KEY);
  } catch (e) {}
}

function storedPhrase() {
  try {
    return sessionStorage.getItem(PHRASE_KEY) || localStorage.getItem(PHRASE_KEY) || "";
  } catch (e) {
    return "";
  }
}

function probe(url) {
  if (probeCache.has(url)) return probeCache.get(url);
  const pending = new Promise((resolve) => {
    const img = new Image();
    const finish = (ok) => {
      window.clearTimeout(timer);
      resolve(ok);
    };
    const timer = window.setTimeout(() => finish(false), 7000);
    img.onload = () => finish((img.naturalWidth || 0) > 16);
    img.onerror = () => finish(false);
    img.referrerPolicy = "no-referrer";
    img.src = url;
  });
  probeCache.set(url, pending);
  return pending;
}

async function cheapShark(title) {
  const res = await fetch("https://www.cheapshark.com/api/1.0/games?limit=8&title=" + encodeURIComponent(title));
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function wikiArt(title) {
  const searchUrl = "https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=search&srlimit=6&srsearch=" + encodeURIComponent(title + " video game");
  const res = await fetch(searchUrl);
  if (!res.ok) return null;
  const data = await res.json();
  const hits = (data.query && data.query.search) || [];
  let best = "";
  let bestScore = 0;
  for (const hit of hits) {
    const pageTitle = String(hit.title || "");
    if (/^list of /i.test(pageTitle)) continue;
    const bare = pageTitle.replace(/\(.*?\)/g, " ");
    let score = scoreTitle(title, bare);
    if (/\(video game\)/i.test(pageTitle)) score += 18;
    if (score > bestScore) {
      bestScore = score;
      best = pageTitle;
    }
  }
  if (!best || bestScore < 60) return null;
  const summaryRes = await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(best));
  if (!summaryRes.ok) return null;
  const summary = await summaryRes.json();
  const image = (summary.originalimage && summary.originalimage.source) || (summary.thumbnail && summary.thumbnail.source);
  const url = safeUrl(image);
  if (!url) return null;
  if (!(await probe(url))) return null;
  return { url, label: summary.title || best };
}

async function coverFor(hit) {
  const appId = hit.steamAppID && String(hit.steamAppID) !== "null" ? String(hit.steamAppID) : "";
  const candidates = [];
  if (appId) {
    candidates.push("https://cdn.cloudflare.steamstatic.com/steam/apps/" + appId + "/library_600x900.jpg");
    candidates.push("https://cdn.cloudflare.steamstatic.com/steam/apps/" + appId + "/header.jpg");
  }
  if (hit.thumb) candidates.push(hit.thumb);
  for (const url of candidates) {
    const safe = safeUrl(url);
    if (safe && await probe(safe)) return safe;
  }
  return "";
}

async function findArt(title) {
  let ranked = [];
  try {
    const hits = await cheapShark(title);
    ranked = hits
      .map((hit) => {
        let score = scoreTitle(title, hit.external || "");
        if (/\b(soundtrack|dlc|ost|bundle|pack)\b/i.test(hit.external || "")) score -= 30;
        if (!hit.steamAppID) score -= 4;
        return { hit, score };
      })
      .filter((row) => row.score >= 60)
      .sort((a, b) => b.score - a.score);
  } catch (e) {
    ranked = [];
  }
  let pool = ranked.filter((row) => row.score >= 84);
  if (!pool.length) pool = ranked;
  pool = pool.slice(0, 4);
  const alts = [];
  const seen = new Set();
  const resolved = await Promise.all(pool.map(async (row) => ({ row, url: await coverFor(row.hit) })));
  for (const item of resolved) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    alts.push({ url: item.url, label: item.row.hit.external || title });
  }
  if (!alts.length) {
    try {
      const wiki = await wikiArt(title);
      if (wiki && !seen.has(wiki.url)) alts.push(wiki);
    } catch (e) {}
  }
  if (!alts.length) return null;
  return { cover: alts[0].url, alts };
}

async function attachArt(id, title) {
  const gen = (lookupGen.get(id) || 0) + 1;
  lookupGen.set(id, gen);
  let art = null;
  try {
    art = await findArt(title);
  } catch (e) {
    art = null;
  }
  if (lookupGen.get(id) !== gen) return;
  const entry = entryById(id);
  if (!entry) return;
  entry.looking = false;
  if (!art) {
    entry.artMiss = true;
  } else {
    entry.cover = art.cover;
    entry.alts = art.alts;
    entry.artMiss = false;
  }
  entry.touchedAt = Date.now();
  save();
  render();
}

function visibleEntries() {
  const q = normalize(find);
  return state.entries.filter((entry) => {
    if (filter !== "all" && entry.status !== filter) return false;
    if (q && !normalize(entry.title).includes(q)) return false;
    return true;
  });
}

function sortEntries(list) {
  return list.slice().sort((a, b) => {
    const live = (b.sessionStart ? 1 : 0) - (a.sessionStart ? 1 : 0);
    if (live) return live;
    return (b.touchedAt || 0) - (a.touchedAt || 0);
  });
}

function coverMarkup(entry) {
  if (entry.cover) {
    return '<img alt="" src="' + esc(entry.cover) + '" referrerpolicy="no-referrer" />' +
      (entry.looking ? '<span class="looking">looking</span>' : "");
  }
  return '<span class="mono">' + esc(initials(entry.title)) + "</span>" +
    (entry.looking ? '<span class="looking">looking</span>' : "") +
    (entry.artMiss ? '<span class="miss">no art</span>' : "");
}

function cardMarkup(entry) {
  const now = Date.now();
  const live = Boolean(entry.sessionStart);
  const statusButtons = ["to-play", "playing", "played"].map((status) => {
    const pressed = entry.status === status ? "true" : "false";
    return '<button type="button" data-act="status" data-status="' + status + '" aria-pressed="' + pressed + '">' + STATUS_LABEL[status] + "</button>";
  }).join("");
  let title = '<button type="button" class="title-hit" data-act="edit-title">' + esc(entry.title) + "</button>";
  if (editingTitleId === entry.id) {
    title = '<input class="title-edit" data-title-edit value="' + esc(entry.title) + '" aria-label="title" />';
  }
  let time = '<button type="button" class="time-read" data-act="edit-time">' + esc(formatPlayed(banked(entry))) + "</button>" +
    '<button type="button" data-act="bump" data-delta="-900000">−15</button>' +
    '<button type="button" data-act="bump" data-delta="900000">+15</button>';
  if (editingTimeId === entry.id && !live) {
    const minutes = Math.floor(banked(entry) / 60000);
    time = '<span class="time-edit"><input data-field="hours" type="number" min="0" max="9999" value="' + Math.floor(minutes / 60) + '" aria-label="hours" />' +
      "<span>h</span>" +
      '<input data-field="mins" type="number" min="0" max="59" value="' + (minutes % 60) + '" aria-label="minutes" />' +
      "<span>m</span>" +
      '<button type="button" data-act="commit-time">set</button></span>';
  }
  let session = live
    ? '<button type="button" class="session is-live" data-act="session" data-clock="' + esc(entry.id) + '"><i class="live-pip" aria-hidden="true"></i>end  ' + esc(formatClock(liveMs(entry, now))) + "</button>"
    : '<button type="button" class="session" data-act="session">start</button>';
  if (pendingEndId === entry.id && live) {
    session = '<div class="confirm-row"><p>add ' + esc(formatPlayed(liveMs(entry, now))) + '?</p>' +
      '<button type="button" data-act="confirm-end">add</button>' +
      '<button type="button" data-act="discard-end">discard</button>' +
      '<button type="button" data-act="cancel-end">keep</button></div>';
  }
  let foot = '<button type="button" data-act="retry">cover</button><button type="button" data-act="ask-drop">drop</button>';
  if (dropId === entry.id) {
    foot = '<span class="miss">drop this?</span><button type="button" data-act="drop">yes</button><button type="button" data-act="cancel-drop">no</button>';
  }
  const alts = (entry.alts || []).length > 1
    ? '<div class="alts">' + entry.alts.map((alt) => {
        const pressed = alt.url === entry.cover ? "true" : "false";
        return '<button type="button" data-act="alt" data-url="' + esc(alt.url) + '" aria-pressed="' + pressed + '" aria-label="' + esc(alt.label || "cover") + '"><img alt="" src="' + esc(alt.url) + '" referrerpolicy="no-referrer" /></button>';
      }).join("") + "</div>"
    : "";
  return '<article class="entry' + (live ? " is-live" : "") + '" data-id="' + esc(entry.id) + '">' +
    '<div class="cover">' + coverMarkup(entry) + "</div>" +
    '<div class="entry-main"><h2>' + title + "</h2>" +
    '<div class="state-toggle" role="group" aria-label="status for ' + esc(entry.title) + '">' + statusButtons + "</div>" +
    '<div class="time-line"><span class="time-label">played</span>' + time + "</div>" +
    session +
    '<div class="entry-foot">' + foot + "</div>" +
    alts +
    "</div></article>";
}

function render() {
  const groups = $("groups");
  if (!groups) return;
  const counts = { all: state.entries.length, playing: 0, "to-play": 0, played: 0 };
  for (const entry of state.entries) counts[entry.status] += 1;
  document.querySelectorAll("[data-filter]").forEach((button) => {
    const key = button.dataset.filter;
    button.setAttribute("aria-pressed", key === filter ? "true" : "false");
    const label = key === "to-play" ? "to play" : key;
    button.textContent = label + " " + (counts[key] || 0);
  });
  const pile = $("pile");
  if (pile) pile.textContent = state.entries.length + " · " + formatPlayed(totalBanked());
  const rows = visibleEntries();
  if (!state.entries.length) {
    groups.innerHTML = '<p class="empty">the pile is empty.</p>';
    return;
  }
  if (!rows.length) {
    groups.innerHTML = '<p class="empty">nothing matches.</p>';
    return;
  }
  const draftTitle = document.querySelector("[data-title-edit]");
  const draftHours = document.querySelector("[data-field=hours]");
  const draftMins = document.querySelector("[data-field=mins]");
  const draft = {
    title: draftTitle ? { value: draftTitle.value, pos: draftTitle.selectionStart } : null,
    hours: draftHours ? draftHours.value : null,
    mins: draftMins ? draftMins.value : null,
    titleFocused: document.activeElement === draftTitle,
  };
  const order = filter === "all" ? STATUSES : [filter];
  groups.innerHTML = order.map((status) => {
    const list = sortEntries(rows.filter((entry) => entry.status === status));
    if (!list.length) return "";
    return '<section class="group"><h3>' + STATUS_LABEL[status] + "  " + list.length + "</h3><div class=\"grid\">" +
      list.map(cardMarkup).join("") + "</div></section>";
  }).join("");
  const titleEdit = groups.querySelector("[data-title-edit]");
  if (titleEdit) {
    if (draft.title && !focusTitle) {
      titleEdit.value = draft.title.value;
      if (draft.titleFocused) {
        titleEdit.focus();
        const pos = draft.title.pos;
        if (Number.isFinite(pos)) titleEdit.setSelectionRange(pos, pos);
      }
    } else if (focusTitle) {
      focusTitle = false;
      titleEdit.focus();
      titleEdit.select();
    }
  }
  const hours = groups.querySelector("[data-field=hours]");
  const mins = groups.querySelector("[data-field=mins]");
  if (hours && draft.hours !== null && !focusTime) hours.value = draft.hours;
  if (mins && draft.mins !== null && !focusTime) mins.value = draft.mins;
  if (focusTime && hours) {
    focusTime = false;
    hours.focus();
    hours.select();
  }
}

function tickClocks() {
  const now = Date.now();
  document.querySelectorAll("[data-clock]").forEach((node) => {
    const entry = entryById(node.dataset.clock);
    if (!entry || !entry.sessionStart || pendingEndId === entry.id) return;
    node.innerHTML = '<i class="live-pip" aria-hidden="true"></i>end  ' + esc(formatClock(liveMs(entry, now)));
  });
}

function commitEnd(entry, keepTime) {
  if (!entry || !entry.sessionStart) return;
  const elapsed = Math.max(0, Date.now() - entry.sessionStart);
  entry.sessionStart = null;
  if (keepTime) entry.playedMs = banked(entry) + elapsed;
  entry.touchedAt = Date.now();
  if (pendingEndId === entry.id) pendingEndId = null;
}

function startSession(entry) {
  for (const other of state.entries) {
    if (other.id === entry.id || !other.sessionStart) continue;
    if (liveMs(other, Date.now()) > LONG_SESSION) {
      pendingEndId = other.id;
      render();
      return;
    }
    commitEnd(other, true);
  }
  entry.sessionStart = Date.now();
  if (entry.status === "to-play") entry.status = "playing";
  entry.touchedAt = Date.now();
  pendingEndId = null;
  save();
  render();
}

function requestEnd(entry) {
  if (!entry.sessionStart) {
    startSession(entry);
    return;
  }
  if (liveMs(entry, Date.now()) > LONG_SESSION) {
    pendingEndId = entry.id;
    render();
    return;
  }
  commitEnd(entry, true);
  save();
  render();
}

function commitTime(article) {
  const entry = entryById(article && article.dataset.id);
  if (!entry || entry.sessionStart) return;
  const hours = article.querySelector("[data-field=hours]");
  const mins = article.querySelector("[data-field=mins]");
  if (!hours || !mins) return;
  const h = Math.max(0, Math.round(Number(hours.value) || 0));
  const m = Math.min(59, Math.max(0, Math.round(Number(mins.value) || 0)));
  entry.playedMs = h * 3600000 + m * 60000;
  entry.touchedAt = Date.now();
  editingTimeId = null;
  save();
  render();
}

function commitTitle(input) {
  if (titleCommit) return;
  const article = input.closest(".entry");
  const entry = entryById(article && article.dataset.id);
  if (!entry || editingTitleId !== entry.id) return;
  titleCommit = true;
  const next = input.value.trim().replace(/\s+/g, " ").slice(0, 180);
  editingTitleId = null;
  if (!next || next === entry.title) {
    render();
    titleCommit = false;
    return;
  }
  entry.title = next;
  entry.cover = "";
  entry.alts = [];
  entry.looking = true;
  entry.artMiss = false;
  entry.touchedAt = Date.now();
  save();
  render();
  titleCommit = false;
  attachArt(entry.id, entry.title);
}

function showBoard() {
  document.documentElement.classList.add("log-open");
  $("gate").classList.add("is-off");
  $("board").classList.remove("is-off");
  render();
  $("title").focus();
}

function showGate() {
  document.documentElement.classList.remove("log-open");
  $("board").classList.add("is-off");
  $("gate").classList.remove("is-off");
  const pass = $("pass");
  if (pass) pass.focus();
}

function lock() {
  try {
    sessionStorage.removeItem(OPEN_KEY);
    localStorage.removeItem(KEEP_KEY);
  } catch (e) {}
  forgetPhrase();
  showGate();
}

function openLog(keep, text) {
  try {
    sessionStorage.setItem(OPEN_KEY, "1");
    if (keep) localStorage.setItem(KEEP_KEY, "1");
    else localStorage.removeItem(KEEP_KEY);
  } catch (e) {}
  rememberPhrase(text, keep);
  showBoard();
  pullVault();
}

function isOpen() {
  try {
    return sessionStorage.getItem(OPEN_KEY) === "1" || localStorage.getItem(KEEP_KEY) === "1";
  } catch (e) {
    return false;
  }
}

function onCardClick(event) {
  const button = event.target.closest("[data-act]");
  if (!button) return;
  const article = button.closest(".entry");
  const entry = entryById(article && article.dataset.id);
  if (!entry) return;
  const act = button.dataset.act;
  if (act === "status") {
    const next = button.dataset.status;
    if (!STATUSES.includes(next) || next === entry.status) return;
    if (next === "played" && entry.sessionStart) {
      if (liveMs(entry, Date.now()) > LONG_SESSION) {
        pendingEndId = entry.id;
        entry.status = next;
        entry.touchedAt = Date.now();
        save();
        render();
        return;
      }
      commitEnd(entry, true);
    }
    entry.status = next;
    entry.touchedAt = Date.now();
    dropId = null;
    save();
    render();
    return;
  }
  if (act === "session") {
    requestEnd(entry);
    return;
  }
  if (act === "confirm-end") {
    commitEnd(entry, true);
    save();
    render();
    return;
  }
  if (act === "discard-end") {
    commitEnd(entry, false);
    save();
    render();
    return;
  }
  if (act === "cancel-end") {
    pendingEndId = null;
    render();
    return;
  }
  if (act === "bump") {
    const delta = Number(button.dataset.delta) || 0;
    entry.playedMs = Math.max(0, banked(entry) + delta);
    entry.touchedAt = Date.now();
    editingTimeId = null;
    save();
    render();
    return;
  }
  if (act === "edit-time") {
    if (entry.sessionStart) return;
    editingTimeId = entry.id;
    editingTitleId = null;
    focusTime = true;
    render();
    return;
  }
  if (act === "commit-time") {
    commitTime(article);
    return;
  }
  if (act === "edit-title") {
    editingTitleId = entry.id;
    editingTimeId = null;
    focusTitle = true;
    render();
    return;
  }
  if (act === "retry") {
    entry.looking = true;
    entry.artMiss = false;
    save();
    render();
    attachArt(entry.id, entry.title);
    return;
  }
  if (act === "alt") {
    const url = safeUrl(button.dataset.url);
    if (!url) return;
    entry.cover = url;
    entry.touchedAt = Date.now();
    save();
    render();
    return;
  }
  if (act === "ask-drop") {
    dropId = entry.id;
    render();
    return;
  }
  if (act === "cancel-drop") {
    dropId = null;
    render();
    return;
  }
  if (act === "drop") {
    state.entries = state.entries.filter((item) => item.id !== entry.id);
    state.dropped = state.dropped || [];
    state.dropped.push({ id: entry.id, at: Date.now() });
    dropId = null;
    if (pendingEndId === entry.id) pendingEndId = null;
    save();
    render();
  }
}

function addTitle(title) {
  const clean = title.trim().replace(/\s+/g, " ").slice(0, 180);
  if (!clean) return;
  const entry = cleanEntry({
    id: uid(),
    title: clean,
    status: "to-play",
    playedMs: 0,
    addedAt: Date.now(),
    touchedAt: Date.now(),
  });
  entry.looking = true;
  state.entries.unshift(entry);
  save();
  render();
  attachArt(entry.id, entry.title);
}

function exportPile() {
  const blob = new Blob([JSON.stringify({ version: 1, entries: state.entries }, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "pilgrimage-log.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function importPile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  const entries = (data && Array.isArray(data.entries) ? data.entries : []).map(cleanEntry).filter(Boolean);
  if (!entries.length) throw new Error("empty");
  if (!window.confirm("Replace the pile with " + entries.length + " entries?")) return;
  const now = Date.now();
  const nextIds = new Set(entries.map((entry) => entry.id));
  state.dropped = state.dropped || [];
  for (const entry of state.entries) {
    if (!nextIds.has(entry.id)) state.dropped.push({ id: entry.id, at: now });
  }
  state.entries = entries;
  dropId = null;
  pendingEndId = null;
  save();
  render();
}

function setTheme(next) {
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
}

function cycleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "darcula";
  const index = THEMES.indexOf(current);
  setTheme(THEMES[(index + 1) % THEMES.length]);
}

$("gate-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const pass = $("pass");
  const msg = $("gate-msg");
  const phrase = pass.value.trim();
  msg.textContent = "";
  if (!phrase || !crypto.subtle) {
    msg.textContent = "no.";
    return;
  }
  const hash = await sha256(phrase);
  if (!hashesEqual(hash, GATE)) {
    msg.textContent = "no.";
    pass.select();
    return;
  }
  pass.value = "";
  openLog($("keep").checked, phrase);
});

$("add-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("title");
  addTitle(input.value);
  input.value = "";
  input.focus();
});

$("groups").addEventListener("click", onCardClick);
$("groups").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    editingTitleId = null;
    editingTimeId = null;
    dropId = null;
    pendingEndId = null;
    render();
    return;
  }
  if (event.key !== "Enter") return;
  if (event.target.matches("[data-title-edit]")) {
    event.preventDefault();
    commitTitle(event.target);
  } else if (event.target.closest(".time-edit")) {
    event.preventDefault();
    commitTime(event.target.closest(".entry"));
  }
});
$("groups").addEventListener("focusout", (event) => {
  const input = event.target;
  if (!input.matches || !input.matches("[data-title-edit]")) return;
  const entryId = input.closest(".entry") && input.closest(".entry").dataset.id;
  const value = input.value;
  window.setTimeout(() => {
    if (titleCommit || editingTitleId !== entryId) return;
    const live = document.querySelector("[data-title-edit]");
    if (!live) return;
    if (document.activeElement === live) return;
    live.value = value;
    commitTitle(live);
  }, 0);
});

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    filter = button.dataset.filter;
    render();
  });
});

$("find").addEventListener("input", () => {
  find = $("find").value;
  render();
});

$("export").addEventListener("click", exportPile);
$("import").addEventListener("change", async () => {
  const file = $("import").files && $("import").files[0];
  $("import").value = "";
  if (!file) return;
  try {
    await importPile(file);
  } catch (e) {
    window.alert("that file is not a log.");
  }
});
$("lock").addEventListener("click", lock);

window.addEventListener("keydown", (event) => {
  const tag = event.target && event.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if ((event.key === "t" || event.key === "T") && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    cycleTheme();
  }
});

window.setInterval(tickClocks, 1000);

$("sync-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (token()) {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    paintSyncForm();
    setSync("server · link a token");
    return;
  }
  const input = $("gh-token");
  const value = (input.value || "").trim();
  if (!value) return;
  setSync("server · checking token");
  try {
    const res = await fetch("https://api.github.com/repos/colorlesspilgrimage/colorlesspilgrimage.github.io", {
      headers: {
        Authorization: "Bearer " + value,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      setSync("server · token refused");
      return;
    }
    localStorage.setItem(TOKEN_KEY, value);
    input.value = "";
    paintSyncForm();
    sawRemote = false;
    pullVault();
  } catch (e) {
    setSync("server · token refused");
  }
});

paintSyncForm();
phrase = storedPhrase();
if (phrase && isOpen()) {
  showBoard();
  pullVault();
} else {
  showGate();
}
