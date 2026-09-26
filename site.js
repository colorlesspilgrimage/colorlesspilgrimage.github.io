(function () {
  var THEMES = [
    { id: "darcula", name: "Darcula" },
    { id: "day", name: "Day" },
    { id: "string", name: "String" },
    { id: "number", name: "Number" },
    { id: "function", name: "Function" },
    { id: "select", name: "Select" },
  ];
  var KEY = "pilgrimage-theme";
  var root = document.documentElement;
  var current = root.getAttribute("data-theme") || "darcula";
  if (!THEMES.some(function (theme) { return theme.id === current; })) current = "darcula";

  var list = document.getElementById("theme-list");

  function paint() {
    var buttons = list.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", buttons[i].dataset.id === current ? "true" : "false");
    }
  }

  function apply(id) {
    current = id;
    root.setAttribute("data-theme", id);
    try { localStorage.setItem(KEY, id); } catch (e) {}
    paint();
  }

  function cycle() {
    var index = 0;
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === current) index = i;
    apply(THEMES[(index + 1) % THEMES.length].id);
  }

  THEMES.forEach(function (theme) {
    var button = document.createElement("button");
    button.type = "button";
    button.dataset.id = theme.id;
    button.textContent = theme.name;
    button.addEventListener("click", function () { apply(theme.id); });
    list.appendChild(button);
  });

  paint();

  window.addEventListener("keydown", function (event) {
    if (event.key !== "t" && event.key !== "T") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    var tag = event.target && event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    event.preventDefault();
    cycle();
  });
})();
