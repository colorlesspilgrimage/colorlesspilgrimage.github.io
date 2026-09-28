// Loaded blocking in <head> so the saved theme applies before first paint.
(function () {
  var THEMES = ["darcula", "day", "string", "number", "function", "select"];
  var KEY = "pilgrimage-theme";
  var root = document.documentElement;

  function current() {
    var id = root.getAttribute("data-theme");
    return THEMES.indexOf(id) === -1 ? THEMES[0] : id;
  }

  function paint() {
    var id = current();
    document.querySelectorAll("[data-theme-id]").forEach(function (node) {
      node.setAttribute("aria-pressed", node.getAttribute("data-theme-id") === id ? "true" : "false");
    });
  }

  function set(id) {
    if (THEMES.indexOf(id) === -1) return;
    root.setAttribute("data-theme", id);
    try { localStorage.setItem(KEY, id); } catch (e) {}
    paint();
  }

  try {
    var saved = localStorage.getItem(KEY);
    if (THEMES.indexOf(saved) !== -1) root.setAttribute("data-theme", saved);
  } catch (e) {}

  document.addEventListener("DOMContentLoaded", paint);
  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest("[data-theme-id]");
    if (button) set(button.getAttribute("data-theme-id"));
  });
  window.addEventListener("keydown", function (event) {
    var tag = event.target && event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if ((event.key === "t" || event.key === "T") && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      set(THEMES[(THEMES.indexOf(current()) + 1) % THEMES.length]);
    }
  });
})();
