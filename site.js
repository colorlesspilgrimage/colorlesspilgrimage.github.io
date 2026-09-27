const WHEEL = ["themes", "github", "x", "mail"];
const THEMES = ["darcula", "day", "string", "number", "function", "select"];
const THEME_KEY = "pilgrimage-theme";

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function buildTree() {
  const rand = mulberry32(20260926);
  const segs = [];
  let order = 0;
  function shoot(x, y, ang, depth, life) {
    if (segs.length >= 130 || life <= 0 || y < 8 || depth > 13) return;
    const len = 6.5 + rand() * 10;
    const ang2 = ang + (rand() - 0.5) * (0.28 + depth * 0.035);
    const x2 = x + Math.sin(ang2) * len * 0.92;
    const y2 = y - Math.cos(ang2) * len * (0.72 + rand() * 0.28);
    const cx = (x + x2) / 2 + (rand() - 0.5) * 5;
    const cy = (y + y2) / 2 + (rand() - 0.5) * 2;
    const leaf = life < 1.4 || depth > 10;
    segs.push({ d: "M " + x.toFixed(1) + " " + y.toFixed(1) + " Q " + cx.toFixed(1) + " " + cy.toFixed(1) + " " + x2.toFixed(1) + " " + y2.toFixed(1), order: order++, leaf, length: len });
    if (leaf) return;
    const forks = depth < 2 ? 3 : rand() > 0.62 ? 2 : 1;
    for (let i = 0; i < forks; i++) {
      const bias = forks === 1 ? (rand() - 0.5) * 0.15 : (i - (forks - 1) / 2) * (0.42 + rand() * 0.18);
      shoot(x2, y2, ang2 + bias, depth + 1, life - (0.72 + rand() * 0.45));
    }
  }
  shoot(100, 148, 0, 0, 9.2);
  shoot(100, 148, -0.35, 0, 7.4);
  shoot(100, 148, 0.35, 0, 7.4);
  return segs;
}
const SEGMENTS = buildTree();
const TREE_LENGTH = Math.round(SEGMENTS.reduce((sum, seg) => sum + seg.length, 0));
const TREE_TIPS = SEGMENTS.filter((seg) => seg.leaf).length;
const SEG_COUNT = SEGMENTS.length;
const rootSegs = document.getElementById("root-segs");
if (rootSegs) {
  rootSegs.innerHTML = SEGMENTS.map((seg) => '<g class="seg" data-order="' + seg.order + '"><path class="seg-hit" d="' + seg.d + '"/><path class="seg-line" d="' + seg.d + '"/></g>').join("");
}

const RESTORE = new WeakMap();
const eats = [];
let theme = "darcula";
let eaten = 0;
let mouthX = 0;
let mouthY = 0;
let pointerX = 0;
let pointerY = 0;
let hasPointer = false;
let seenPointer = false;
let reduced = false;

function $(id) { return document.getElementById(id); }
function text(id, value) {
  const node = $(id);
  if (node && node.textContent !== value) node.textContent = value;
}
function paintThemeButtons() {
  document.querySelectorAll("[data-theme-id]").forEach((node) => {
    node.setAttribute("aria-pressed", node.dataset.themeId === theme ? "true" : "false");
  });
}
function setTheme(next) {
  theme = next;
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  paintThemeButtons();
}
function cycleTheme() {
  const index = THEMES.indexOf(theme);
  setTheme(THEMES[(index + 1) % THEMES.length]);
}
function grownStats() {
  const live = document.querySelectorAll(".seg:not(.eaten)").length;
  const ratio = SEG_COUNT === 0 ? 1 : live / SEG_COUNT;
  text("stat-cuts", String(SEG_COUNT - live));
  text("stat-members", String(SEG_COUNT));
  text("stat-tips", String(TREE_TIPS));
  text("stat-length", String(Math.round(TREE_LENGTH * ratio)));
  text("stat-grown", Math.round(ratio * 100) + "%");
  text("stat-reached", Math.round(ratio * 6) + " / 6");
  text("stat-root", Math.round(ratio * 100) + "%");
}
function pulse() {
  const now = performance.now();
  while (eats.length && now - eats[0] > 8000) eats.shift();
  const poly = $("echo-line");
  if (!poly) return;
  const buckets = 18;
  const counts = Array.from({ length: buckets }, () => 0);
  for (const stamp of eats) {
    const slot = Math.min(buckets - 1, Math.floor(((now - stamp) / 8000) * buckets));
    counts[buckets - 1 - slot] += 1;
  }
  const max = Math.max(1, ...counts);
  poly.setAttribute("points", counts.map((count, index) => {
    const x = (index / Math.max(1, counts.length - 1)) * 100;
    const y = 28 - (count / max) * 22;
    return x.toFixed(1) + "," + y.toFixed(1);
  }).join(" "));
}
function devour(node) {
  const target = node && node.closest ? node.closest(".glyph, .seg") : null;
  if (!target || target.classList.contains("eaten") || target.closest(".no-bite")) return;
  target.classList.add("eaten");
  eaten += 1;
  eats.push(performance.now());
  $("worm-mouth")?.classList.add("feeding");
  const previous = RESTORE.get(target);
  if (previous) window.clearTimeout(previous);
  const order = Number(target.dataset.order || 0);
  const wait = target.classList.contains("seg") ? 700 + order * 22 : 1600 + Math.random() * 1200;
  RESTORE.set(target, window.setTimeout(() => {
    target.classList.remove("eaten");
    RESTORE.delete(target);
    if (target.classList.contains("seg")) grownStats();
  }, reduced ? 400 : wait));
  if (target.classList.contains("seg")) grownStats();
}
function sample(x, y) {
  const radius = 11;
  const points = [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius], [radius * 0.7, radius * 0.7], [-radius * 0.7, radius * 0.7]];
  for (const [dx, dy] of points) devour(document.elementFromPoint(x + dx, y + dy));
}
function placeEye() {
  const frame = $("eye-frame");
  const mark = $("eye-sq");
  if (!frame || !mark || !hasPointer) return;
  const rect = frame.getBoundingClientRect();
  if (!rect.width) return;
  const nx = (pointerX - rect.left) / rect.width;
  const ny = (pointerY - rect.top) / rect.height;
  const x = Math.max(6, Math.min(86, nx * 70 + 8));
  const y = Math.max(8, Math.min(62, ny * 40 + 14));
  mark.setAttribute("transform", "translate(" + x.toFixed(1) + " " + y.toFixed(1) + ")");
}
function tick() {
  const mouth = $("worm-mouth");
  if (!mouth) return;
  const k = reduced ? 1 : 0.22;
  mouthX += (pointerX - mouthX) * k;
  mouthY += (pointerY - mouthY) * k;
  mouth.style.transform = "translate(" + mouthX + "px, " + mouthY + "px)";
  if (hasPointer) mouth.classList.add("live");
  mouth.classList.toggle("ghost", !hasPointer);
  const speed = Math.hypot(pointerX - mouthX, pointerY - mouthY);
  if (hasPointer && speed > 0.7) sample(mouthX, mouthY);
  const stage = document.querySelector(".stage");
  if (stage && hasPointer) {
    const rect = stage.getBoundingClientRect();
    text("hand-readout", ((pointerX - rect.left) / Math.max(1, rect.width)).toFixed(2) + "  " + ((pointerY - rect.top) / Math.max(1, rect.height)).toFixed(2));
  } else {
    text("hand-readout", "—  —");
  }
  placeEye();
}
function arc(t) {
  const bulge = Math.sin(Math.max(0, Math.min(1, t)) * Math.PI);
  const x = 0.28 + bulge * 0.46;
  const y = t;
  const dx = Math.cos(t * Math.PI) * Math.PI * 0.46;
  const rot = Math.atan2(dx, 1) * (180 / Math.PI);
  return { x: x * 100, y: y * 100, rot };
}
function startWheel() {
  const root = document.getElementById("wheel");
  if (!root) return;
  const cards = Array.from(root.querySelectorAll(".card"));
  const sparks = Array.from(root.querySelectorAll(".spark"));
  const arcPath = document.getElementById("wheel-arc");
  let offset = 1.5;
  let drag = null;
  const horizontal = () => window.matchMedia("(max-width: 860px)").matches;
  const paint = () => {
    const mobile = horizontal();
    const spacing = mobile ? 0.22 : 0.24;
    let hot = 0;
    let hotDist = Infinity;
    cards.forEach((card, index) => {
      if (mobile) {
        card.style.transform = "";
        card.style.left = "";
        card.style.top = "";
        card.style.visibility = "";
        card.style.zIndex = "";
        return;
      }
      const t = 0.5 + (index - offset) * spacing;
      const dist = Math.abs(index - offset);
      if (t < 0.05 || t > 0.9) {
        card.style.visibility = "hidden";
        return;
      }
      const point = arc(t);
      const focus = dist < 0.45;
      const scale = focus ? 1 : Math.max(0.72, 0.84 - dist * 0.06);
      const rot = Math.max(-8, Math.min(8, point.rot * 0.18));
      card.style.visibility = "visible";
      card.style.left = point.x + "%";
      card.style.top = point.y + "%";
      card.style.transform = "translate(-50%, -50%) rotate(" + rot + "deg) scale(" + scale + ")";
      card.style.zIndex = String(20 - Math.round(dist));
      card.classList.toggle("is-hot", focus);
      card.style.opacity = String(Math.max(0.35, 1 - dist * 0.16));
      if (dist < hotDist) { hotDist = dist; hot = index; }
    });
    if (mobile) {
      const mid = root.scrollLeft + root.clientWidth / 2;
      cards.forEach((card) => {
        const center = card.offsetLeft + card.offsetWidth / 2;
        card.classList.toggle("is-hot", Math.abs(center - mid) < card.offsetWidth * 0.45);
      });
    } else {
      sparks.forEach((spark, index) => {
        const point = arc((index + 0.5) / sparks.length);
        const jitter = ((index * 17) % 7) - 3;
        spark.style.left = "calc(" + point.x + "% + " + jitter + "px)";
        spark.style.top = "calc(" + point.y + "% + " + ((index % 5) - 2) + "px)";
      });
      if (arcPath) {
        let d = "";
        for (let i = 0; i <= 24; i++) {
          const point = arc(i / 24);
          d += (i === 0 ? "M " : "L ") + point.x + " " + point.y + " ";
        }
        arcPath.setAttribute("d", d);
      }
    }
    root.dataset.ready = "1";
    void hot;
    void WHEEL;
  };
  root.addEventListener("wheel", (event) => {
    if (horizontal()) return;
    event.preventDefault();
    const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    offset = Math.max(0, Math.min(WHEEL.length - 1, offset + delta * 0.0022));
    paint();
  }, { passive: false });
  root.addEventListener("scroll", paint, { passive: true });
  root.addEventListener("pointerdown", (event) => {
    if (horizontal()) return;
    drag = { y: event.clientY, x: event.clientX, offset, moved: false };
  });
  window.addEventListener("pointermove", (event) => {
    if (!drag || horizontal()) return;
    const delta = drag.y - event.clientY;
    if (Math.abs(delta) > 5 || Math.abs(event.clientX - drag.x) > 5) drag.moved = true;
    if (!drag.moved) return;
    offset = Math.max(0, Math.min(WHEEL.length - 1, drag.offset + delta / 150));
    paint();
  });
  const onUp = () => {
    if (drag && drag.moved) root.dataset.suppress = "1";
    drag = null;
    window.setTimeout(() => { delete root.dataset.suppress; }, 50);
  };
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  root.addEventListener("click", (event) => {
    if (root.dataset.suppress !== "1") return;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  window.addEventListener("resize", paint);
  paint();
}

const savedTheme = document.documentElement.getAttribute("data-theme");
if (THEMES.indexOf(savedTheme) !== -1) theme = savedTheme;
reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
paintThemeButtons();
grownStats();
pulse();
startWheel();
document.querySelectorAll("[data-theme-id]").forEach((node) => {
  node.addEventListener("click", () => {
    if (THEMES.indexOf(node.dataset.themeId) !== -1) setTheme(node.dataset.themeId);
  });
});
window.addEventListener("pointermove", (event) => {
  const prevX = pointerX;
  const prevY = pointerY;
  pointerX = event.clientX;
  pointerY = event.clientY;
  hasPointer = true;
  if (!seenPointer) {
    seenPointer = true;
    mouthX = pointerX;
    mouthY = pointerY;
    return;
  }
  const dist = Math.hypot(pointerX - prevX, pointerY - prevY);
  const steps = Math.max(1, Math.ceil(dist / 12));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    sample(prevX + (pointerX - prevX) * t, prevY + (pointerY - prevY) * t);
  }
}, { passive: true });
window.addEventListener("pointerdown", (event) => {
  pointerX = event.clientX;
  pointerY = event.clientY;
  hasPointer = true;
  if (!seenPointer) {
    seenPointer = true;
    mouthX = pointerX;
    mouthY = pointerY;
  }
}, { passive: true });
const onLeave = () => { hasPointer = false; };
document.documentElement.addEventListener("pointerleave", onLeave);
window.addEventListener("blur", onLeave);
window.addEventListener("keydown", (event) => {
  const tag = event.target && event.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if ((event.key === "t" || event.key === "T") && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    cycleTheme();
  }
});
let lastPulse = 0;
const loop = (now) => {
  tick();
  if (now - lastPulse > 240) {
    lastPulse = now;
    pulse();
    if (!document.querySelector(".glyph.eaten, .seg.eaten")) $("worm-mouth")?.classList.remove("feeding");
  }
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
