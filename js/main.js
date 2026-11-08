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
import { configured, VIEWS } from "./config.js?v=2026-11-08-client-gate-4";
import { $, el, openClosers } from "./ui.js";
import { state } from "./state.js";
import { createFirebaseStore } from "./store/firebase.js";
import { createDemoStore } from "./store/demo.js";
import { openLogin, renderAccount } from "./auth.js?v=2026-11-08-cancel-gate";
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

  let started = false;
  const gate = $("#accessGate");
  const gateForm = $("#accessForm");
  const gatePassword = $("#accessPassword");
  const gateError = $("#accessError");
  const gateHopLogin = $("#accessHopLogin");
  const gateButton = gateForm?.querySelector('button[type="submit"]');

  const startApplication = afterStart => {
    if (started) {
      afterStart?.();
      return false;
    }
    started = true;
    let initialAuthStateReceived = false;

    // Login state. The demo store calls back immediately; Firebase calls
    // back after restoring the browser's session.
    state.store.onAuth(m => {
      state.me = m;
      renderAccount();
      if (!started) return;
      [...openClosers].forEach(c => c());
      openView(VIEWS[state.view]?.hopOnly && !state.me ? "plan" : state.view);
      if (!initialAuthStateReceived) {
        initialAuthStateReceived = true;
        afterStart?.();
      }
    });
    renderAccount();

    $("#warnClose")?.addEventListener("click", () => { state.warnHidden = true; renderAccount(); });
    window.addEventListener("hashchange", () => openView(viewFromHash()));
    openView(viewFromHash());
    return true;
  };

  const markReady = () => {
    window.__halReady = true;
    document.querySelectorAll('.fatal[data-kind="watchdog"]').forEach(n => n.remove());
  };

  if (!gate || !gateForm || !gatePassword || !gateError || !gateButton) {
    fail("Nie udało się wyświetlić formularza hasła.", "Odśwież stronę. Jeśli problem się powtarza, sprawdź index.html.");
    return;
  }

  gateForm.addEventListener("submit", async e => {
    e.preventDefault();
    gateError.textContent = "";
    gateButton.disabled = true;
    try {
      await state.store.unlockApp(gatePassword.value);
      gate.hidden = true;
      gatePassword.value = "";
      startApplication();
    } catch (error) {
      const code = error?.code || "";
      gateError.textContent = code === "app/wrong-password"
        ? "Nieprawidłowe hasło."
        : "Nie udało się sprawdzić hasła. Sprawdź połączenie i opublikowanie reguł Firestore.";
    } finally {
      gateButton.disabled = false;
      gatePassword.focus();
    }
  });

  gateHopLogin?.addEventListener("click", e => {
    e.preventDefault();
    gate.hidden = true;
    startApplication(() => openLogin({
      onCancel: () => {
        gate.hidden = false;
        gatePassword.focus();
      }
    }));
  });

  try {
    if (await state.store.checkAppAccess()) {
      gate.hidden = true;
      startApplication();
    } else {
      gate.hidden = false;
      gatePassword.focus();
    }
  } catch {
    gate.hidden = false;
    gateError.textContent = "Nie można połączyć się z usługą dostępu. Sprawdź połączenie lub wdrożenie Firebase.";
  }
  markReady();
}

init().catch(e => {
  console.error(e);
  fail("Błąd podczas uruchamiania aplikacji.", String(e?.message || e));
});
