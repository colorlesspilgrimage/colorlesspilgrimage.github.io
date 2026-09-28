const WHEEL = ["themes", "github", "x", "mail"];
const THEMES = ["darcula", "day", "string", "number", "function", "select"];
const THEME_KEY = "pilgrimage-theme";

const EYE = [["55.4","40.0"],["43.6","43.1"],["51.0","33.7"],["59.2","46.4"],["31.9","38.3"],["68.2","33.8"],["43.6","52.8"],["37.1","26.7"],["55.1","41.0"],["42.0","41.8"],["55.0","34.3"],["54.5","47.7"],["34.1","35.1"],["71.1","37.5"],["35.7","50.8"],["46.4","25.1"],["54.1","41.9"],["41.4","40.2"],["58.4","35.5"],["49.3","48.1"],["38.2","32.5"],["71.4","41.5"],["29.6","47.6"],["56.2","25.4"],["52.7","42.5"],["41.8","38.6"],["60.8","37.3"],["44.2","47.4"],["43.8","30.8"],["69.1","45.4"],["26.0","43.4"],["65.2","27.4"],["50.9","42.8"],["43.2","37.2"],["61.8","39.5"],["39.7","45.9"],["50.1","30.2"],["64.5","48.5"],["25.3","38.8"],["72.4","30.9"],["49.0","42.8"],["45.4","36.1"],["61.5","41.7"],["36.5","43.7"],["56.4","30.8"],["58.1","50.7"],["27.6","34.3"],["76.8","35.6"],["47.3","42.5"],["48.2","35.5"],["59.7","43.7"],["35.0","41.0"],["61.9","32.5"],["50.8","51.5"],["32.6","30.6"],["78.0","40.8"],["45.8","41.8"],["51.2","35.4"],["56.7","45.2"],["35.3","38.2"],["66.0","35.2"],["43.3","51.0"],["39.7","27.9"],["75.9","45.8"],["44.9","41.0"],["54.1","35.9"],["53.0","46.1"],["37.3","35.6"],["68.1","38.4"],["36.7","49.1"],["48.1","26.8"],["70.5","50.2"]];
function paintEye() {
  const host = document.getElementById("eye-dots");
  if (!host) return;
  host.innerHTML = EYE.map((dot) => '<circle cx="' + dot[0] + '" cy="' + dot[1] + '" r="0.55"/>').join("");
}


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
let mouthX = 0;
let mouthY = 0;
let pointerX = 0;
let pointerY = 0;
let hasPointer = false;
let seenPointer = false;
let reduced = false;

function $(id) { return document.getElementById(id); }
const mouthEl = $("worm-mouth");
const echoLine = $("echo-line");
const eyeFrame = $("eye-frame");
const eyeMark = $("eye-sq");
const stageEl = document.querySelector(".stage");
const sauronEl = $("sauron");
const sauronArt = $("sauron-art");
const termEl = document.querySelector(".term");
const textNodes = new Map();
const BITE_R = 11;
const BITE = [[0, 0], [BITE_R, 0], [-BITE_R, 0], [0, BITE_R], [0, -BITE_R], [BITE_R * 0.7, BITE_R * 0.7], [-BITE_R * 0.7, BITE_R * 0.7]];
let liveSegs = SEG_COUNT;
let statsDirty = false;
let boxes = null;
let termBox = null;
let frame = 0;
let mouthLive = false;
let mouthGhost = false;
let mouthFeeding = false;
let mouthTransform = "";
let eyeAt = "";
let leanAt = "";

function dropBoxes() {
  boxes = null;
  termBox = null;
}
function layoutBoxes() {
  boxes = {
    eye: eyeFrame ? eyeFrame.getBoundingClientRect() : null,
    sauron: sauronEl ? sauronEl.getBoundingClientRect() : null,
    stage: stageEl ? stageEl.getBoundingClientRect() : null,
  };
}
function requestTick() {
  if (frame || document.hidden) return;
  frame = requestAnimationFrame(loop);
}
if (window.ResizeObserver) {
  const boxesObserver = new ResizeObserver(dropBoxes);
  [sauronEl, eyeFrame, stageEl, termEl].forEach((node) => { if (node) boxesObserver.observe(node); });
}
function text(id, value) {
  let node = textNodes.get(id);
  if (node === undefined) {
    node = document.getElementById(id);
    textNodes.set(id, node);
  }
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
function grownStats(full) {
  const ratio = SEG_COUNT === 0 ? 1 : liveSegs / SEG_COUNT;
  const pct = Math.round(ratio * 100) + "%";
  text("stat-cuts", String(SEG_COUNT - liveSegs));
  text("stat-length", String(Math.round(TREE_LENGTH * ratio)));
  text("stat-grown", pct);
  text("stat-reached", Math.round(ratio * 6) + " / 6");
  text("stat-root", pct);
  if (!full) return;
  text("stat-members", String(SEG_COUNT));
  text("stat-tips", String(TREE_TIPS));
}
function pulse() {
  const now = performance.now();
  while (eats.length && now - eats[0] > 8000) eats.shift();
  const poly = echoLine;
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
  const isSeg = target.classList.contains("seg");
  if (isSeg) {
    liveSegs -= 1;
    statsDirty = true;
  }
  eats.push(performance.now());
  if (!mouthFeeding && mouthEl) {
    mouthFeeding = true;
    mouthEl.classList.add("feeding");
  }
  const previous = RESTORE.get(target);
  if (previous) window.clearTimeout(previous);
  const order = Number(target.dataset.order || 0);
  const wait = isSeg ? 700 + order * 22 : 1600 + Math.random() * 1200;
  RESTORE.set(target, window.setTimeout(() => {
    target.classList.remove("eaten");
    RESTORE.delete(target);
    if (!isSeg) return;
    liveSegs += 1;
    grownStats();
  }, reduced ? 400 : wait));
  requestTick();
}
function inTerm(x, y) {
  if (!termBox && termEl) termBox = termEl.getBoundingClientRect();
  if (!termBox || !termBox.width) return true;
  return x >= termBox.left - 14 && x <= termBox.right + 14 && y >= termBox.top - 14 && y <= termBox.bottom + 14;
}
function sample(x, y) {
  if (!inTerm(x, y)) return;
  for (let i = 0; i < BITE.length; i++) devour(document.elementFromPoint(x + BITE[i][0], y + BITE[i][1]));
  if (!statsDirty) return;
  statsDirty = false;
  grownStats();
}
function placeEye() {
  if (!eyeFrame || !eyeMark || !hasPointer) return;
  if (!boxes) layoutBoxes();
  const rect = boxes.eye;
  if (!rect || !rect.width) return;
  const nx = (pointerX - rect.left) / rect.width;
  const ny = (pointerY - rect.top) / rect.height;
  const x = Math.max(6, Math.min(86, nx * 70 + 8));
  const y = Math.max(8, Math.min(62, ny * 40 + 14));
  const next = "translate(" + x.toFixed(1) + " " + y.toFixed(1) + ")";
  if (next === eyeAt) return;
  eyeAt = next;
  eyeMark.setAttribute("transform", next);
}

const SAURON = [
  "        .    |    .       ",
  "     .-' \\   |   / '-.    ",
  "   .'     \\  |  /     '.  ",
  "  /    .---\\ | /---.    \\ ",
  " |    /     \\|/     \\    |",
  " |   |   .'--+--'.   |   |",
  " |   |  /   §§§   \\  |   |",
  " |   | |   §§§§§   | |   |",
  " |   | |   §§§§§   | |   |",
  " |   | |   §§§§§   | |   |",
  " |   |  \\   §§§   /  |   |",
  " |   |   '.__|__.'   |   |",
  " |    \\     /|\\     /    |",
  "  \\    '---/ | \\---'    / ",
  "   '.     /  |  \\     .'  ",
  "     '-. /   |   \\ .-'    ",
  "        '    |    '       ",
];
const IRIS = [];
SAURON.forEach((line, y) => {
  for (let x = 0; x < line.length; x++) if (line[x] === "§") IRIS.push({ x, y });
});
const IRIS_XS = [...new Set(IRIS.map((cell) => cell.x))].sort((a, b) => a - b);
const IRIS_YS = [...new Set(IRIS.map((cell) => cell.y))].sort((a, b) => a - b);
const IRIS_BY_X = new Map();
for (let i = 0; i < IRIS.length; i++) {
  const cell = IRIS[i];
  let ys = IRIS_BY_X.get(cell.x);
  if (!ys) IRIS_BY_X.set(cell.x, ys = []);
  ys.push(cell.y);
}
IRIS_BY_X.forEach((ys) => ys.sort((a, b) => a - b));
let aimX = IRIS_XS[Math.floor(IRIS_XS.length / 2)];
let aimY = (IRIS_YS[0] + IRIS_YS[IRIS_YS.length - 1]) / 2;
let leanX = 0;
let leanY = 0;
let slitKey = "";

function paintSauron(ax, ay) {
  let col = IRIS_XS[0];
  let best = Infinity;
  for (const x of IRIS_XS) {
    const d = Math.abs(x - ax);
    if (d < best) { best = d; col = x; }
  }
  const ys = IRIS_BY_X.get(col) || [];
  const lit = new Set();
  if (ys.length <= 3) ys.forEach((y) => lit.add(y));
  else {
    let bestScore = Infinity;
    let start = 0;
    for (let i = 0; i <= ys.length - 3; i++) {
      const mean = (ys[i] + ys[i + 1] + ys[i + 2]) / 3;
      const score = Math.abs(mean - ay);
      if (score < bestScore) { bestScore = score; start = i; }
    }
    lit.add(ys[start]);
    lit.add(ys[start + 1]);
    lit.add(ys[start + 2]);
  }
  return SAURON.map((line, y) => {
    let out = "";
    for (let x = 0; x < line.length; x++) {
      const ch = line[x];
      if (ch === "§") out += x === col && lit.has(y) ? "<b>|</b>" : " ";
      else out += ch;
    }
    return out;
  }).join("\n");
}

function placeSauron() {
  if (!sauronEl || !sauronArt || !IRIS.length) return false;
  if (!sauronArt.innerHTML) sauronArt.innerHTML = paintSauron(aimX, aimY);
  if (!boxes) layoutBoxes();
  const rect = boxes.sauron;
  if (!rect || !rect.width) return false;
  const cx = rect.left + rect.width * 0.5;
  const cy = rect.top + rect.height * 0.52;
  const midX = (IRIS_XS[0] + IRIS_XS[IRIS_XS.length - 1]) / 2;
  const midY = (IRIS_YS[0] + IRIS_YS[IRIS_YS.length - 1]) / 2;
  let tx = midX;
  let ty = midY;
  let lx = 0;
  let ly = 0;
  if (hasPointer) {
    const dx = pointerX - cx;
    const dy = pointerY - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const reach = Math.min(1, dist / 420);
    const ux = dx / dist;
    const uy = dy / dist;
    tx = midX + ux * reach * (IRIS_XS[IRIS_XS.length - 1] - IRIS_XS[0]) * 0.5;
    ty = midY + uy * reach * (IRIS_YS[IRIS_YS.length - 1] - IRIS_YS[0]) * 0.5;
    lx = ux * reach * 16;
    ly = uy * reach * 10;
  }
  const k = reduced ? 1 : 0.16;
  aimX += (tx - aimX) * k;
  aimY += (ty - aimY) * k;
  leanX += (lx - leanX) * k;
  leanY += (ly - leanY) * k;
  const nextLean = reduced ? "" : "translate(" + leanX.toFixed(2) + "px," + leanY.toFixed(2) + "px) rotate(" + (leanX * 0.42).toFixed(2) + "deg)";
  if (nextLean !== leanAt) {
    leanAt = nextLean;
    sauronArt.style.transform = nextLean;
  }
  const key = Math.round(aimX) + ":" + Math.round(aimY);
  if (key !== slitKey) {
    slitKey = key;
    sauronArt.innerHTML = paintSauron(aimX, aimY);
  }
  return Math.abs(tx - aimX) > 0.08 || Math.abs(ty - aimY) > 0.08 || Math.abs(lx - leanX) > 0.2 || Math.abs(ly - leanY) > 0.2;
}

function tick() {
  if (!mouthEl) return false;
  const k = reduced ? 1 : 0.22;
  mouthX += (pointerX - mouthX) * k;
  mouthY += (pointerY - mouthY) * k;
  const nextMouth = "translate(" + mouthX.toFixed(2) + "px, " + mouthY.toFixed(2) + "px)";
  if (nextMouth !== mouthTransform) {
    mouthTransform = nextMouth;
    mouthEl.style.transform = nextMouth;
  }
  if (hasPointer !== mouthLive) {
    mouthLive = hasPointer;
    mouthEl.classList.toggle("live", hasPointer);
  }
  const ghost = !hasPointer;
  if (ghost !== mouthGhost) {
    mouthGhost = ghost;
    mouthEl.classList.toggle("ghost", ghost);
  }
  const speed = Math.hypot(pointerX - mouthX, pointerY - mouthY);
  if (hasPointer && speed > 0.7) sample(mouthX, mouthY);
  if (!boxes) layoutBoxes();
  const stage = boxes.stage;
  if (stage && hasPointer && stage.width) {
    text("hand-readout", ((pointerX - stage.left) / Math.max(1, stage.width)).toFixed(2) + "  " + ((pointerY - stage.top) / Math.max(1, stage.height)).toFixed(2));
  } else {
    text("hand-readout", "—  —");
  }
  placeEye();
  const sauronMoving = placeSauron();
  return speed > 0.45 || sauronMoving;
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
  let arcDrawn = false;
  let mobileLaid = false;
  const mobileQuery = window.matchMedia("(max-width: 860px)");
  const horizontal = () => mobileQuery.matches;
  const writeStyle = (node, prop, value) => {
    if (node.style[prop] !== value) node.style[prop] = value;
  };
  const drawArc = () => {
    if (arcDrawn) return;
    arcDrawn = true;
    sparks.forEach((spark, index) => {
      const point = arc((index + 0.5) / sparks.length);
      const jitter = ((index * 17) % 7) - 3;
      spark.style.left = "calc(" + point.x + "% + " + jitter + "px)";
      spark.style.top = "calc(" + point.y + "% + " + ((index % 5) - 2) + "px)";
    });
    if (!arcPath) return;
    let d = "";
    for (let i = 0; i <= 24; i++) {
      const point = arc(i / 24);
      d += (i === 0 ? "M " : "L ") + point.x + " " + point.y + " ";
    }
    arcPath.setAttribute("d", d);
  };
  const paint = () => {
    const mobile = horizontal();
    const spacing = mobile ? 0.22 : 0.24;
    if (mobile) {
      if (!mobileLaid) {
        mobileLaid = true;
        cards.forEach((card) => {
          writeStyle(card, "transform", "");
          writeStyle(card, "left", "");
          writeStyle(card, "top", "");
          writeStyle(card, "visibility", "");
          writeStyle(card, "zIndex", "");
          writeStyle(card, "opacity", "");
        });
      }
      const mid = root.scrollLeft + root.clientWidth / 2;
      cards.forEach((card) => {
        const center = card.offsetLeft + card.offsetWidth / 2;
        card.classList.toggle("is-hot", Math.abs(center - mid) < card.offsetWidth * 0.45);
      });
      root.dataset.ready = "1";
      return;
    }
    mobileLaid = false;
    drawArc();
    cards.forEach((card, index) => {
      const t = 0.5 + (index - offset) * spacing;
      const dist = Math.abs(index - offset);
      if (t < 0.05 || t > 0.9) {
        writeStyle(card, "visibility", "hidden");
        return;
      }
      const point = arc(t);
      const focus = dist < 0.45;
      const scale = focus ? 1 : Math.max(0.72, 0.84 - dist * 0.06);
      const rot = Math.max(-8, Math.min(8, point.rot * 0.18));
      writeStyle(card, "visibility", "visible");
      writeStyle(card, "left", point.x + "%");
      writeStyle(card, "top", point.y + "%");
      writeStyle(card, "transform", "translate(-50%, -50%) rotate(" + rot + "deg) scale(" + scale + ")");
      writeStyle(card, "zIndex", String(20 - Math.round(dist)));
      card.classList.toggle("is-hot", focus);
      writeStyle(card, "opacity", String(Math.max(0.35, 1 - dist * 0.16)));
    });
    root.dataset.ready = "1";
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
  window.addEventListener("resize", () => {
    dropBoxes();
    paint();
  });
  paint();
}

const savedTheme = document.documentElement.getAttribute("data-theme");
if (THEMES.indexOf(savedTheme) !== -1) theme = savedTheme;
reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
paintThemeButtons();
paintEye();
grownStats(true);
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
    requestTick();
    return;
  }
  const dist = Math.hypot(pointerX - prevX, pointerY - prevY);
  if (dist >= 1) {
    const steps = Math.ceil(dist / 12);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      sample(prevX + (pointerX - prevX) * t, prevY + (pointerY - prevY) * t);
    }
  }
  requestTick();
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
  requestTick();
}, { passive: true });
const onLeave = () => {
  hasPointer = false;
  requestTick();
};
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
function loop(now) {
  frame = 0;
  if (document.hidden) return;
  const moving = tick();
  if (eats.length && now - lastPulse > 240) {
    lastPulse = now;
    pulse();
  }
  if (mouthFeeding && RESTORE.size === 0 && mouthEl) {
    mouthFeeding = false;
    mouthEl.classList.remove("feeding");
  }
  if (moving || eats.length) requestTick();
}
document.addEventListener("visibilitychange", () => {
  document.documentElement.classList.toggle("page-hidden", document.hidden);
  if (!document.hidden) requestTick();
});
requestTick();
