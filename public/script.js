(function () {
  var THEMES = ["latte", "frappe", "macchiato", "mocha"];
  var root = document.documentElement;
  var stored = null;
  try { stored = localStorage.getItem("theme"); } catch (e) {}

  var initial = THEMES.indexOf(stored) !== -1
    ? stored
    : (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "latte" : "mocha");

  applyTheme(initial);

  function applyTheme(name) {
    root.setAttribute("data-theme", name);
    try { localStorage.setItem("theme", name); } catch (e) {}
    document.querySelectorAll(".theme-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.swatch === name);
      btn.setAttribute("aria-pressed", btn.dataset.swatch === name ? "true" : "false");
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".theme-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { applyTheme(btn.dataset.swatch); });
    });
    applyTheme(root.getAttribute("data-theme") || initial);
  });
})();

document.addEventListener("DOMContentLoaded", function () {
  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();
});
