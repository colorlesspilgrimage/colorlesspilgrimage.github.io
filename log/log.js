const STORE = "pilgrimage-log";
const OPEN_KEY = "pilgrimage-log-open";
const KEEP_KEY = "pilgrimage-log-keep";
const VAULT_KEY = "pilgrimage-log-vault";
const KEY_DB = "pilgrimage-log";
const RENTRY = "cp-log-vault";
const KDF_ITERS = 210000;
const EDIT_SALT = "pilgrimage-log-edit-v3";
const MIN_PHRASE = 12;
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
// { key, salt, iter, editCode, phrase, legacy }. phrase is "" unless typed on this page load; it is never stored.
let session = null;
let backupCanon = null;
let rekeying = false;
let gateBusy = false;
let sawRemote = false;
let pushTimer = 0;
let pushing = false;
let pushTries = 0;
let suspendPush = false;
let clockTimer = 0;
let filterButtons = null;

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

function tidyTitle(value) {
  return String(value).trim().replace(/\s+/g, " ").slice(0, 180);
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
  const title = tidyTitle(raw.title);
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

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function kdfRounds(iterations) {
  return Math.max(100000, Math.min(600000, Number(iterations) || KDF_ITERS));
}

function passKey(passphrase) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey", "deriveBits"]);
}

// Non-extractable, so a kept session can use the log without holding the passphrase.
async function deriveKeyed(passphrase, salt, iterations) {
  const iter = kdfRounds(iterations);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64ToBytes(salt), iterations: iter, hash: "SHA-256" },
    await passKey(passphrase),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  return { key, salt, iter };
}

function freshKeyed(passphrase) {
  return deriveKeyed(passphrase, bytesToB64(crypto.getRandomValues(new Uint8Array(16))), KDF_ITERS);
}

// Guessing the passphrase from the edit code costs a full PBKDF2 run, same as from the vault.
async function deriveEditCode(passphrase) {
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(EDIT_SALT), iterations: KDF_ITERS, hash: "SHA-256" },
    await passKey(passphrase),
    64
  );
  return toHex(new Uint8Array(bits));
}

// Edit code of pastes written before deriveEditCode existed; used once to move such a paste over.
async function legacyEditCode(passphrase) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("pilgrimage-log-edit-v2"));
  return toHex(new Uint8Array(sig)).slice(0, 16);
}

function parseVault(text) {
  const vault = JSON.parse(text);
  if (!vault || vault.v !== 1 || typeof vault.salt !== "string" || typeof vault.iv !== "string" || typeof vault.data !== "string") {
    throw new Error("vault");
  }
  return vault;
}

function sameKdf(keyed, vault) {
  return keyed.salt === vault.salt && keyed.iter === kdfRounds(vault.iter);
}

// Pushes reuse the salt so one derived key keeps working; the IV is fresh every time.
async function sealVault(keyed, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, keyed.key, new TextEncoder().encode(JSON.stringify(obj)));
  return JSON.stringify({
    v: 1,
    kdf: "PBKDF2-SHA256",
    iter: keyed.iter,
    salt: keyed.salt,
    iv: bytesToB64(iv),
    data: bytesToB64(new Uint8Array(cipher)),
  });
}

async function openVault(key, vault) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(vault.iv) }, key, b64ToBytes(vault.data));
  const data = JSON.parse(new TextDecoder().decode(plain));
  if (!data || !Array.isArray(data.entries)) throw new Error("vault");
  return data;
}

// The server copy is under a key this session cannot follow: rentry refused the edit code, or the
// vault was re-keyed and no passphrase was typed on this page load.
class StaleKey extends Error {}

// adopt: take the vault's salt as the session key, so later pushes stay readable by the stored key.
async function unseal(text, adopt) {
  const vault = parseVault(text);
  if (sameKdf(session, vault)) return openVault(session.key, vault);
  if (!session.phrase) throw new StaleKey("key");
  const keyed = await deriveKeyed(session.phrase, vault.salt, vault.iter);
  const data = await openVault(keyed.key, vault);
  if (adopt) {
    Object.assign(session, keyed);
    await keepSession();
  }
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

function setSync(text) {
  const node = $("sync");
  if (node) node.textContent = text;
}

function applyRemote(plain) {
  suspendPush = true;
  mergeRemote(plain);
  saveLocal();
  suspendPush = false;
  render();
}

function schedulePush() {
  if (suspendPush || !session || !sawRemote) return;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => { pushVault(); }, 1200);
}

function cachedVault() {
  try {
    return localStorage.getItem(VAULT_KEY);
  } catch (e) {
    return null;
  }
}

function cacheVault(text) {
  try {
    localStorage.setItem(VAULT_KEY, text);
  } catch (e) {}
}

async function readBackup() {
  const res = await fetch("/log/vault.json?t=" + Date.now(), { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("read");
  return res.text();
}

async function rentry(path, fields) {
  const res = await fetch("https://rentry.co/api/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  const data = await res.json();
  // rentry answers HTTP 200 and puts the real status in the body.
  const status = String(data && data.status);
  if (status === "400" && /edit code/i.test(String(data.errors || data.content))) throw new StaleKey("edit code");
  return { status, content: data && data.content };
}

async function readRentry(code) {
  const res = await rentry("fetch/" + RENTRY, { edit_code: code });
  if (res.status === "404") return null;
  if (res.status !== "200" || !res.content) throw new Error("read");
  return res.content.text || null;
}

async function writeRentry(code, text, nextCode) {
  const fields = { edit_code: code, text };
  if (nextCode) fields.new_edit_code = nextCode;
  let res = await rentry("edit/" + RENTRY, fields);
  if (res.status === "404") res = await rentry("new", { url: RENTRY, edit_code: nextCode || code, text });
  if (res.status !== "200") throw new Error("write");
}

async function remoteText() {
  try {
    return await readRentry(session.editCode);
  } catch (e) {
    if (!(e instanceof StaleKey) || !session.phrase || !session.legacy) throw e;
    const old = await legacyEditCode(session.phrase);
    const text = await readRentry(old);
    if (text !== null) await writeRentry(old, text, session.editCode);
    session.legacy = false;
    return text;
  }
}

// Flags the committed log/vault.json when it no longer matches the pile.
async function markSaved(current) {
  setSync("server · saved");
  if (backupCanon === null) {
    backupCanon = "";
    try {
      const text = await readBackup();
      if (text) backupCanon = canon(await unseal(text, false));
    } catch (e) {}
  }
  if (session !== current || !$("sync").textContent.startsWith("server · saved")) return;
  setSync(backupCanon === canon(snapshot()) ? "server · saved" : "server · saved · backup behind");
}

// rentry is unreachable: fold in the committed copy so a fresh browser still gets the pile.
async function pullBackup(current) {
  try {
    const text = await readBackup();
    const plain = text ? await unseal(text, false) : null;
    if (plain && session === current) applyRemote(plain);
  } catch (e) {}
  if (session !== current) return;
  sawRemote = true;
  setSync("server · offline");
}

async function pullVault() {
  const current = session;
  if (!current) return;
  setSync("server · reading");
  let plain = null;
  try {
    const text = await remoteText();
    if (session !== current) return;
    sawRemote = true;
    if (!text) {
      setSync("server · empty");
      if (state.entries.length) schedulePush();
      return;
    }
    plain = await unseal(text, true);
    if (session !== current) return;
    cacheVault(text);
  } catch (e) {
    if (session !== current) return;
    if (e instanceof StaleKey) relock();
    else if (sawRemote) setSync("server · unreadable");
    else await pullBackup(current);
    return;
  }
  applyRemote(plain);
  if (canon(snapshot()) !== canon(plain)) schedulePush();
  else markSaved(current);
}

async function pushVault() {
  const current = session;
  if (!current || !sawRemote || pushing) return;
  pushing = true;
  let retry = false;
  setSync("server · writing");
  try {
    const text = await remoteText();
    if (text) {
      const plain = await unseal(text, true);
      if (session !== current) return;
      if (canon(snapshot()) !== canon(plain)) {
        applyRemote(plain);
        state.updatedAt = Date.now();
        saveLocal();
      }
    }
    const sealed = await sealVault(current, snapshot());
    await writeRentry(current.editCode, sealed);
    if (session !== current) return;
    cacheVault(sealed);
    pushTries = 0;
    markSaved(current);
  } catch (e) {
    if (session !== current) return;
    if (e instanceof StaleKey) relock();
    else if (pushTries < 2) {
      pushTries += 1;
      retry = true;
    } else setSync("server · not written");
  } finally {
    pushing = false;
    if (retry) schedulePush();
  }
}

function keyStore(mode, run) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(KEY_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("session");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("session", mode);
      const req = run(tx.objectStore("session"));
      tx.oncomplete = () => {
        db.close();
        resolve(req.result);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

async function keepSession() {
  if (!session) return;
  const { key, salt, iter, editCode } = session;
  try {
    await keyStore("readwrite", (store) => store.put({ key, salt, iter, editCode }, "current"));
  } catch (e) {}
}

// Unlocking opens a vault reachable without rentry, so a mistyped passphrase never spends one of
// rentry's few edit-code attempts. Returns the session key, "no", or "offline".
async function unlockKeyed(passphrase) {
  const texts = [];
  const cached = cachedVault();
  if (cached) texts.push(cached);
  let reachable = true;
  try {
    const backup = await readBackup();
    if (backup) texts.push(backup);
  } catch (e) {
    reachable = false;
  }
  const tried = new Set();
  for (const text of texts) {
    let vault;
    try {
      vault = parseVault(text);
    } catch (e) {
      continue;
    }
    const id = vault.salt + ":" + kdfRounds(vault.iter);
    if (tried.has(id)) continue;
    tried.add(id);
    try {
      const keyed = await deriveKeyed(passphrase, vault.salt, vault.iter);
      await openVault(keyed.key, vault);
      // Only the old build wrote a mac, and its paste still takes the HMAC edit code.
      keyed.legacy = "mac" in vault;
      return keyed;
    } catch (e) {}
  }
  if (tried.size) return "no";
  if (!reachable) return "offline";
  // No vault exists yet: this passphrase starts one.
  return freshKeyed(passphrase);
}

async function changePhrase(currentPhrase, nextPhrase) {
  const current = session;
  if (!hashesEqual(await deriveEditCode(currentPhrase), current.editCode)) throw new Error("current");
  current.phrase = currentPhrase;
  window.clearTimeout(pushTimer);
  pushing = true;
  try {
    // Merge the server copy first so the rewrite drops nothing.
    const text = await remoteText();
    if (text) applyRemote(await unseal(text, true));
    const keyed = await freshKeyed(nextPhrase);
    const editCode = await deriveEditCode(nextPhrase);
    const sealed = await sealVault(keyed, snapshot());
    if (session !== current) throw new Error("locked");
    await writeRentry(current.editCode, sealed, editCode);
    session = { ...keyed, editCode, phrase: nextPhrase, legacy: false };
    sawRemote = true;
    backupCanon = "";
    cacheVault(sealed);
    await keepSession();
    download("vault.json", sealed);
    markSaved(session);
  } finally {
    pushing = false;
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

function clockLabel(entry, now) {
  return "end  " + formatClock(liveMs(entry, now));
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
    ? '<button type="button" class="session is-live" data-act="session" data-clock="' + esc(entry.id) + '"><i class="live-pip" aria-hidden="true"></i><span class="clock-read">' + esc(clockLabel(entry, now)) + "</span></button>"
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
  if (!filterButtons) filterButtons = document.querySelectorAll("[data-filter]");
  filterButtons.forEach((button) => {
    const key = button.dataset.filter;
    const pressed = key === filter ? "true" : "false";
    if (button.getAttribute("aria-pressed") !== pressed) button.setAttribute("aria-pressed", pressed);
    const label = (key === "to-play" ? "to play" : key) + " " + (counts[key] || 0);
    if (button.textContent !== label) button.textContent = label;
  });
  const pile = $("pile");
  if (pile) pile.textContent = state.entries.length + " · " + formatPlayed(totalBanked());
  const rows = visibleEntries();
  if (!state.entries.length) {
    groups.innerHTML = '<p class="empty">the pile is empty.</p>';
    armClock();
    return;
  }
  if (!rows.length) {
    groups.innerHTML = '<p class="empty">nothing matches.</p>';
    armClock();
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
  armClock();
}

function armClock() {
  const open = document.documentElement.classList.contains("log-open");
  let live = false;
  if (open) {
    for (const entry of state.entries) {
      if (entry.sessionStart && pendingEndId !== entry.id) {
        live = true;
        break;
      }
    }
  }
  if (live) {
    if (clockTimer) return;
    tickClocks();
    clockTimer = window.setInterval(tickClocks, 1000);
    return;
  }
  if (!clockTimer) return;
  window.clearInterval(clockTimer);
  clockTimer = 0;
}

function tickClocks() {
  const now = Date.now();
  document.querySelectorAll("[data-clock]").forEach((node) => {
    const entry = entryById(node.dataset.clock);
    if (!entry || !entry.sessionStart || pendingEndId === entry.id) return;
    const label = clockLabel(entry, now);
    const text = node.querySelector(".clock-read");
    if (text) {
      if (text.textContent !== label) text.textContent = label;
      return;
    }
    node.textContent = label;
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
  const next = tidyTitle(input.value);
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
  armClock();
}

function lock() {
  try {
    sessionStorage.removeItem(OPEN_KEY);
    localStorage.removeItem(KEEP_KEY);
  } catch (e) {}
  session = null;
  sawRemote = false;
  backupCanon = null;
  window.clearTimeout(pushTimer);
  keyStore("readwrite", (store) => store.delete("current")).catch(() => {});
  $("rekey-form").reset();
  $("rekey-form").classList.add("is-off");
  $("rekey-msg").textContent = "";
  setSync("server");
  showGate();
}

// The server copy moved to a key this session cannot follow. Drop the cached copy too, or the
// old passphrase would keep opening it.
function relock() {
  try {
    localStorage.removeItem(VAULT_KEY);
  } catch (e) {}
  lock();
  $("gate-msg").textContent = "the passphrase changed. enter the current one.";
}

function openLog(keep, next) {
  try {
    sessionStorage.setItem(OPEN_KEY, "1");
    if (keep) localStorage.setItem(KEEP_KEY, "1");
    else localStorage.removeItem(KEEP_KEY);
  } catch (e) {}
  session = next;
  sawRemote = false;
  backupCanon = null;
  pushTries = 0;
  keepSession();
  showBoard();
  pullVault();
}

async function restore() {
  let saved = null;
  if (isOpen()) {
    try {
      saved = await keyStore("readonly", (store) => store.get("current"));
    } catch (e) {}
  }
  if (!saved || !saved.key) {
    lock();
    return;
  }
  session = { key: saved.key, salt: saved.salt, iter: saved.iter, editCode: saved.editCode, phrase: "", legacy: false };
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
  const clean = tidyTitle(title);
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

function download(name, text) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function exportPile() {
  download("pilgrimage-log.json", JSON.stringify({ version: 1, entries: state.entries }, null, 2));
}

async function backupVault() {
  if (!session) return;
  download("vault.json", await sealVault(session, snapshot()));
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

$("gate-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (gateBusy) return;
  const pass = $("pass");
  const msg = $("gate-msg");
  const phrase = pass.value.trim();
  if (!phrase || !crypto.subtle) {
    msg.textContent = "no.";
    return;
  }
  gateBusy = true;
  msg.textContent = "checking…";
  try {
    const keyed = await unlockKeyed(phrase);
    if (keyed === "no" || keyed === "offline") {
      msg.textContent = keyed === "no" ? "no." : "offline. the passphrase cannot be checked.";
      pass.select();
      return;
    }
    const editCode = await deriveEditCode(phrase);
    pass.value = "";
    msg.textContent = "";
    openLog($("keep").checked, { ...keyed, editCode, phrase });
  } finally {
    gateBusy = false;
  }
});

$("rekey").addEventListener("click", () => {
  const form = $("rekey-form");
  form.classList.toggle("is-off");
  if (!form.classList.contains("is-off")) $("rekey-now").focus();
});

$("rekey-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (rekeying || !session) return;
  const msg = $("rekey-msg");
  const now = $("rekey-now").value.trim();
  const next = $("rekey-next").value.trim();
  if (next.length < MIN_PHRASE) {
    msg.textContent = "use at least " + MIN_PHRASE + " characters.";
    return;
  }
  if (next !== $("rekey-again").value.trim()) {
    msg.textContent = "the new ones differ.";
    return;
  }
  if (next === now) {
    msg.textContent = "that is the current one.";
    return;
  }
  rekeying = true;
  msg.textContent = "re-sealing…";
  try {
    await changePhrase(now, next);
    $("rekey-form").reset();
    msg.textContent = "changed. commit the downloaded vault.json as log/vault.json.";
  } catch (e) {
    if (e instanceof StaleKey) relock();
    else msg.textContent = e.message === "current" ? "the current passphrase is wrong." : "the server did not take it. nothing changed.";
  } finally {
    rekeying = false;
  }
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

document.addEventListener("visibilitychange", () => {
  document.documentElement.classList.toggle("page-hidden", document.hidden);
  if (document.hidden) {
    if (clockTimer) {
      window.clearInterval(clockTimer);
      clockTimer = 0;
    }
    return;
  }
  armClock();
});

$("find").addEventListener("input", () => {
  find = $("find").value;
  render();
});

$("export").addEventListener("click", exportPile);
$("backup").addEventListener("click", backupVault);
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

// Older builds kept the passphrase itself in storage.
try {
  sessionStorage.removeItem("pilgrimage-log-phrase");
  localStorage.removeItem("pilgrimage-log-phrase");
} catch (e) {}
restore();
