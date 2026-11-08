/**
 * main.js
 * ---------------------------------------------------------------------------
 * Entry point, loaded by index.html (<script type="module" src="js/main.js">).
 *
 * Start-up sequence:
 *   1. pick the data store: real Firebase, or local demo if not configured,
 *   2. listen for login/logout and update the UI when it changes,
 *   3. listen for URL-hash changes (tab clicks, Back button),
 *   4. open the view named in the URL (or the masterplan),
 *   5. tell the safety net in index.html that start-up succeeded.
 *
 * Any error during start-up is shown on the page (via window.__halFail from
 * index.html) instead of leaving a blank page.
 *
 * Module dependency direction (no circular imports):
 *   main → views / auth → plan / kanban / admin → state → ui → config
 * ---------------------------------------------------------------------------
 */
import { configured, VIEWS } from "./config.js";
import { $, el, openClosers } from "./ui.js";
import { state } from "./state.js";
import { createFirebaseStore } from "./store/firebase.js";
import { createDemoStore } from "./store/demo.js";
import { renderAccount } from "./auth.js";
import { openView, viewFromHash } from "./views.js";

// Shows a start-up error on the page. Uses the safety net from index.html;
// falls back to a plain message if index.html is an old version without it.
function fail(title, detail) {
  if (typeof window.__halFail === "function") { window.__halFail(title, detail, "error"); return; }
  const main = $("#main");
  if (main) main.replaceChildren(el("p", { class: "fatal", text: `${title} ${detail}` }));
}

async function init() {
  // 1. Data store. Loading Firebase can fail (wrong config, no internet,
  //    CDN blocked) – then show a clear error instead of a blank page.
  try {
    state.store = configured ? await createFirebaseStore() : createDemoStore();
  } catch (e) {
    console.error(e);
    fail("Nie udało się połączyć z bazą danych.",
      `Sprawdź konfigurację Firebase w pliku js/config.js i połączenie z internetem. Szczegóły: ${e?.message || e}`);
    return;
  }

  // The "preview mode" banner is visible only in demo mode.
  // Every element lookup is null-safe: if the browser still has an OLD
  // index.html cached while the JS files are already new, missing elements
  // must not stop the whole app.
  const demo = $("#demo");
  if (demo) demo.hidden = configured;

  // 2. Login state. `started` prevents opening the view twice: the demo store
  //    calls this callback immediately, before step 4 has run.
  let started = false;
  state.store.onAuth(m => {
    state.me = m;
    renderAccount();
    if (!started) return;
    // Close all open dialogs – they may show data or buttons that are no
    // longer valid (e.g. the admin panel right after logout).
    [...openClosers].forEach(c => c());
    // Re-open the current view so HoP-only elements appear/disappear.
    // A guest who was on the HoP board is sent back to the masterplan.
    openView(VIEWS[state.view]?.hopOnly && !state.me ? "plan" : state.view);
  });
  renderAccount();

  // "×" on the HoP warning bar hides it for the rest of this page visit.
  $("#warnClose")?.addEventListener("click", () => { state.warnHidden = true; renderAccount(); });

  // 3. Navigation via the URL hash.
  window.addEventListener("hashchange", () => openView(viewFromHash()));

  // 4. First view.
  started = true;
  openView(viewFromHash());

  // 5. Start-up finished: from now on errors are handled by the app itself.
  //    Also remove a "did not start" watchdog message if a very slow
  //    connection made the app start after the 20-second limit.
  window.__halReady = true;
  document.querySelectorAll('.fatal[data-kind="watchdog"]').forEach(n => n.remove());
}

init().catch(e => {
  console.error(e);
  fail("Błąd podczas uruchamiania aplikacji.", String(e?.message || e));
});
