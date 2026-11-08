/**
 * admin.js
 * ---------------------------------------------------------------------------
 * Admin panel (opened by the console-icon square, visible to admins only):
 *   - list of Patrolowe accounts with activate/deactivate,
 *   - form to create a new account,
 *   - form to change the admin's OWN password,
 *   - activity log (newest 300 entries).
 *
 * Hiding this panel from non-admins is only UI; firestore.rules make sure
 * only admins can read members/logs or change accounts.
 *
 * Limitation: the free Firebase plan offers no way for the browser to reset
 * ANOTHER user's password. If a Patrolowa forgets her password, deactivate the
 * account and create a new one with a different login.
 * ---------------------------------------------------------------------------
 */
import { normLogin, LOGIN_RE } from "./config.js";
import { el, toast, errMsg, authMsg, openModal } from "./ui.js";
import { state, act } from "./state.js";

/**
 * "Change my password" form – only reachable from the admin panel, because
 * regular Patrolowe nie mogą samodzielnie zmieniać hasła.
 * Requires the current password (Firebase re-authenticates with it).
 */
export function ownPasswordForm() {
  const cur = el("input", { id: "p-cur", type: "password", autocomplete: "current-password", required: true });
  const nw = el("input", { id: "p-new", type: "password", autocomplete: "new-password", required: true, minlength: "8" });
  const rep = el("input", { id: "p-rep", type: "password", autocomplete: "new-password", required: true });
  const err = el("p", { class: "err" });
  const btn = el("button", { class: "btn red", type: "submit", text: "Zmień hasło" });
  return el("form", {
    class: "create pwd",   // .pwd = 4-column layout on desktop, stacked on phones
    onsubmit: async e => {
      e.preventDefault();
      err.textContent = "";
      if (nw.value.length < 8) { err.textContent = "Nowe hasło musi mieć co najmniej 8 znaków."; return; }
      if (nw.value !== rep.value) { err.textContent = "Nowe hasła się różnią."; return; }
      btn.disabled = true;
      try {
        await state.store.changePassword(cur.value, nw.value);
        state.store.log(state.me, "Zmiana hasła", "").catch(() => {});
        toast("Hasło zmienione.");
        cur.value = nw.value = rep.value = "";   // never leave passwords in the form
      } catch (ex) {
        // "invalid…" here means the CURRENT password was wrong.
        err.textContent = (ex?.code || "").includes("invalid") ? "Obecne hasło jest nieprawidłowe." : authMsg(ex);
      } finally { btn.disabled = false; }
    }
  },
    el("div", {}, el("label", { for: "p-cur", text: "Obecne hasło" }), cur),
    el("div", {}, el("label", { for: "p-new", text: "Nowe (min. 8 znaków)" }), nw),
    el("div", {}, el("label", { for: "p-rep", text: "Powtórz nowe" }), rep),
    btn,
    el("div", { style: "grid-column:1 / -1" }, err)
  );
}

function sharedPasswordForm() {
  const nw = el("input", { id: "p-shared-new", type: "password", autocomplete: "new-password", required: true, minlength: "8", maxlength: "128" });
  const rep = el("input", { id: "p-shared-rep", type: "password", autocomplete: "new-password", required: true, minlength: "8", maxlength: "128" });
  const err = el("p", { class: "err" });
  const btn = el("button", { class: "btn red", type: "submit", text: "Zmień wspólne hasło" });
  return el("form", {
    class: "create pwd",
    onsubmit: async e => {
      e.preventDefault();
      err.textContent = "";
      if (nw.value.length < 8 || nw.value.length > 128) {
        err.textContent = "Hasło musi mieć od 8 do 128 znaków.";
        return;
      }
      if (nw.value !== rep.value) {
        err.textContent = "Nowe hasła się różnią.";
        return;
      }
      btn.disabled = true;
      try {
        await state.store.changeAppPassword(nw.value);
        state.store.log(state.me, "Zmiana wspólnego hasła aplikacji", "").catch(() => {});
        toast("Wspólne hasło zmienione. Poprzednie hasło przestało działać.");
        nw.value = rep.value = "";
      } catch (ex) {
        err.textContent = authMsg(ex);
      } finally {
        btn.disabled = false;
      }
    }
  },
    el("div", {}, el("label", { for: "p-shared-new", text: "Nowe wspólne hasło" }), nw),
    el("div", {}, el("label", { for: "p-shared-rep", text: "Powtórz hasło" }), rep),
    btn,
    el("div", { style: "grid-column:1 / -1" }, err)
  );
}

/* ---------- Admin panel ---------- */

export function openAdmin() {
  if (state.me?.role !== "admin") return;

  // Table bodies are filled by live subscriptions (see the bottom).
  const membersBody = el("tbody");
  const logBody = el("tbody");

  // Formats a log timestamp. Firebase returns a Timestamp object (toDate()),
  // demo mode an ISO string. A brand-new entry may have no server time yet
  // (pending write) → shown as "teraz" (now).
  const fmt = v => {
    const d = v?.toDate ? v.toDate() : v ? new Date(v) : null;
    return d ? d.toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" }) : "teraz";
  };
  const dateKey = v => {
    const d = v?.toDate ? v.toDate() : v ? new Date(v) : new Date();
    return Number.isNaN(d.getTime()) ? "unknown" : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  const dateHeading = v => {
    const d = v?.toDate ? v.toDate() : v ? new Date(v) : new Date();
    return Number.isNaN(d.getTime())
      ? "Nieznana data"
      : d.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  };
  const displayDetails = value => String(value || "").replace(/\bHoP(?=:|\))/g, "Patrolowa");

  // Accounts table. The admin's own row has no button: rules forbid an admin
  // to modify their own member document (prevents accidental self-lockout).
  const renderMembers = list => {
    membersBody.replaceChildren(...list.map(m => {
      const self = m.id === state.me.uid;
      return el("tr", {},
        // The role is shown in its own column on desktop (.c-role) and,
        // because that column is hidden on phones, also under the login.
        el("td", {}, m.login, el("span", { class: "role-inline hint", text: m.role === "admin" ? "Administrator" : "Patrolowy" })),
        el("td", { class: "c-role", text: m.role === "admin" ? "Administrator" : "Patrolowy" }),
        el("td", {}, el("span", { class: m.active ? "tag" : "tag off", text: m.active ? "Aktywne" : "Wyłączone" })),
        el("td", { class: "nowrap" }, self ? el("span", { class: "hint", text: "To Ty" }) :
          el("button", {
            class: "btn ghost small", type: "button", text: m.active ? "Dezaktywuj" : "Aktywuj",
            onclick: () => act(state.store.setMemberActive(m.id, !m.active), m.active ? "Dezaktywacja konta" : "Aktywacja konta", m.login).catch(() => {})
          }))
      );
    }));
  };

  // Activity log table (newest first).
  const renderLogs = list => {
    if (!list.length) {
      logBody.replaceChildren(el("tr", {}, el("td", { colspan: "4", class: "hint", text: "Brak wpisów." })));
      return;
    }

    const rows = [];
    let currentDay = null;
    for (const entry of list) {
      const key = dateKey(entry.at);
      if (key !== currentDay) {
        rows.push(el("tr", { class: "log-day" },
          el("th", { colspan: "4", scope: "rowgroup", text: dateHeading(entry.at) })
        ));
        currentDay = key;
      }
      rows.push(el("tr", {},
        el("td", { class: "nowrap", text: fmt(entry.at) }),
        entry.uid ? el("td", { text: entry.login }) : el("td", { class: "hint", text: "Gość" }),
        el("td", { text: entry.action }),
        el("td", { text: displayDetails(entry.details) })
      ));
    }
    logBody.replaceChildren(...rows);
  };

  // "Create account" form. The start password is shown in plain text
  // (type="text") so the admin can read it out / copy it to the person.
  const loginIn = el("input", { id: "a-login", required: true, autocapitalize: "none", spellcheck: "false", placeholder: "np. jan.kowalski" });
  const pwdIn = el("input", { id: "a-pwd", type: "text", required: true, minlength: "8", autocomplete: "off" });
  const roleIn = el("select", { id: "a-role" }, el("option", { value: "hop" }, "Patrolowy"), el("option", { value: "admin" }, "Administrator"));
  const err = el("p", { class: "err" });
  const createBtn = el("button", { class: "btn red", type: "submit", text: "Utwórz konto" });

  const createForm = el("form", {
    class: "create",
    onsubmit: async e => {
      e.preventDefault();
      err.textContent = "";
      const login = normLogin(loginIn.value);
      // Same login format as LOGIN_RE in config.js and the rules.
      if (!LOGIN_RE.test(login)) { err.textContent = "Login: 3–40 znaków, małe litery, cyfry, kropka, myślnik lub podkreślnik."; return; }
      if (pwdIn.value.length < 8) { err.textContent = "Hasło musi mieć co najmniej 8 znaków."; return; }
      createBtn.disabled = true;
      try {
        await state.store.createMember(login, pwdIn.value, roleIn.value);
        state.store.log(state.me, "Utworzenie konta", `${login} (${roleIn.value === "admin" ? "administrator" : "Patrolowy"})`).catch(() => {});
        toast(`Konto ${login} utworzone. Przekaż hasło tej osobie osobiście.`);
        loginIn.value = ""; pwdIn.value = "";
      } catch (ex) {
        err.textContent = authMsg(ex);   // e.g. "login already taken"
      } finally { createBtn.disabled = false; }
    }
  },
    el("div", {}, el("label", { for: "a-login", text: "Login" }), loginIn),
    el("div", {}, el("label", { for: "a-pwd", text: "Hasło startowe" }), pwdIn),
    el("div", {}, el("label", { for: "a-role", text: "Rola" }), roleIn),
    createBtn
  );

  // Panel layout.
  let close;
  const panel = el("div", { "aria-labelledby": "a-h" },
    el("div", { class: "modal-head" },
      el("h2", { id: "a-h", text: "Panel admina" }),
      el("button", { class: "btn ghost small", type: "button", text: "Zamknij", onclick: () => close() })),
    el("h3", { text: "Konta Patrolowych" }),
    el("div", { class: "tbl-wrap" }, el("table", {},
      el("thead", {}, el("tr", {}, el("th", { text: "Login" }), el("th", { class: "c-role", text: "Rola" }), el("th", { text: "Status" }), el("th", { text: "" }))),
      membersBody)),
    el("h3", { text: "Dodaj konto" }),
    createForm, err,
    el("p", { class: "hint", text: "Patrolowy nie może samodzielnie zmienić hasła ani go tu zresetować. Jeśli zapomni hasła, dezaktywuj konto i utwórz nowe z innym loginem." }),
    el("h3", { text: "Moje hasło" }),
    ownPasswordForm(),
    el("h3", { text: "Hasło dostępu do aplikacji" }),
    el("p", { class: "hint", text: "Hasło jest przechowywane jawnie w Firestore i sprawdzane w przeglądarce. To tylko ekran wejściowy — nie zabezpiecza danych przed osobami znającymi adres aplikacji." }),
    sharedPasswordForm(),
    el("h3", { text: "Dziennik zdarzeń" }),
    el("div", { class: "tbl-wrap log" }, el("table", {},
      el("thead", {}, el("tr", {}, el("th", { text: "Kiedy" }), el("th", { text: "Kto" }), el("th", { text: "Co" }), el("th", { text: "Szczegóły" }))),
      logBody))
  );

  // Live data for the two tables while the panel is open; both listeners
  // are stopped in onClose so they don't keep consuming database reads.
  const u1 = state.store.subscribeMembers(renderMembers, e => toast(errMsg(e)));
  const u2 = state.store.subscribeLogs(renderLogs, e => toast(errMsg(e)));
  close = openModal(panel, { wide: true, red: true, onClose: () => { u1?.(); u2?.(); } });
}
