(function () {
  var THEMES = [
    { id: "ink", name: "Ink", mood: "Warm black. A late desk." },
    { id: "paper", name: "Paper", mood: "Morning light. No glare." },
    { id: "river", name: "River", mood: "The Mississippi after dark." },
    { id: "ember", name: "Ember", mood: "A lamp, not a warning." },
    { id: "moss", name: "Moss", mood: "Green glass. Low light." },
    { id: "dusk", name: "Dusk", mood: "Blue hour, with a gold mark." },
  ];
  var KEY = "pilgrimage-theme";
  var root = document.documentElement;
  var current = root.getAttribute("data-theme") || "ink";
  if (!THEMES.some(function (theme) { return theme.id === current; })) current = "ink";

  var nameEl = document.getElementById("theme-name");
  var list = document.getElementById("theme-list");
  var toggle = document.getElementById("theme-toggle");

  function apply(id, persist) {
    current = id;
    root.setAttribute("data-theme", id);
    var theme = THEMES.filter(function (item) { return item.id === id; })[0];
    nameEl.textContent = theme.name;
    toggle.setAttribute("aria-label", "Theme is " + theme.name + ". Press T or activate to change it.");
    var buttons = list.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", buttons[i].dataset.id === id ? "true" : "false");
    }
    if (persist) {
      try { localStorage.setItem(KEY, id); } catch (e) {}
    }
  }

  function cycle() {
    var index = 0;
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === current) index = i;
    apply(THEMES[(index + 1) % THEMES.length].id, true);
  }

  THEMES.forEach(function (theme) {
    var li = document.createElement("li");
    var button = document.createElement("button");
    button.type = "button";
    button.dataset.id = theme.id;
    button.innerHTML =
      '<span class="name"><span class="swatch" aria-hidden="true"></span>' +
      theme.name +
      '</span><span class="mood">' +
      theme.mood +
      "</span>";
    button.addEventListener("click", function () { apply(theme.id, true); });
    li.appendChild(button);
    list.appendChild(li);
  });

  apply(current, false);
  toggle.addEventListener("click", cycle);

  window.addEventListener("keydown", function (event) {
    if (event.key !== "t" && event.key !== "T") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    var tag = event.target && event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    event.preventDefault();
    cycle();
  });

  var clock = document.getElementById("clock");
  function tick() {
    clock.textContent = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date());
  }
  tick();
  window.setInterval(tick, 30000);
})();
