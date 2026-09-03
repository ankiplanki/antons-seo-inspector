const api = globalThis.browser || globalThis.chrome;

Sentry.init({
  dsn: "https://e1da536eab1acb8fabb634aa50cc85bf@o4508716372197376.ingest.us.sentry.io/4511180549128192",
  release: "antons-seo-inspector@1.0.0",
});

function escHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const tabButtons = document.querySelectorAll(".tab");
const tabPanels = document.querySelectorAll(".tab-panel");

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;
    tabButtons.forEach((b) => b.classList.toggle("active", b === btn));
    tabPanels.forEach((p) => p.classList.toggle("active", p.id === `panel-${target}`));
  });
});
