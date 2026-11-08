/**
 * views.js
 * ---------------------------------------------------------------------------
 * Tabs, URL-hash navigation and switching between views.
 *
 * The open view is reflected in the URL hash (#plan, #program, #kwaterka,
 * #organizacja, #hop). This lets SharePoint embed a specific board directly,
 * e.g. iframe src=".../#kwaterka", and makes the browser Back button work.
 *
 * Flow: tab click → location.hash changes → "hashchange" event (registered in
 * main.js) → openView() → subscribes to live data → renderPlan()/renderBoard().
 * ---------------------------------------------------------------------------
 */
import { VIEWS } from "./config.js";
import { $, el, toast, readErrMsg } from "./ui.js";
import { state } from "./state.js";
import { renderPlan, openEvent } from "./plan.js";
import { renderBoard } from "./kanban.js";

// Unsubscribe function of the current live-data subscription. Only one view
// listens at a time; switching views stops the previous listener so we don't
// waste database reads or render a hidden board.
let unsub = null;

// Reads the view ID from the URL hash. Falls back to the masterplan when the
// hash is empty/unknown, or when a guest tries to open a HoP-only view.
export const viewFromHash = () => {
  const h = location.hash.slice(1);
  if (!VIEWS[h]) return "plan";
  if (VIEWS[h].hopOnly && !state.me) return "plan";
  return h;
};

/* ---------- Tabs ---------- */

// (Re)draws the tab buttons. HoP-only tabs are skipped for guests – hiding
// them is just UI; the actual protection is in firestore.rules.
// Clicking a tab only changes the hash; the "hashchange" listener does the rest.
export function renderTabs() {
  const nav = $("#tabs");
  if (!nav) return;
  nav.replaceChildren();
  for (const [id, v] of Object.entries(VIEWS)) {
    if (v.hopOnly && !state.me) continue;
    nav.append(el("button", {
      class: "tab", type: "button", role: "tab", "data-board": id, "aria-selected": String(id === state.view),
      text: v.tab, onclick: () => { if (state.view !== id) location.hash = id; }
    }));
  }
  // On phones the tabs are one sideways-scrolling row: make sure the active
  // tab is visible. We set scrollLeft directly instead of scrollIntoView(),
  // which could also scroll the SharePoint page around the iframe.
  const active = nav.querySelector('[aria-selected="true"]');
  if (active && nav.scrollWidth > nav.clientWidth) {
    nav.scrollLeft = Math.max(0, active.offsetLeft - nav.offsetLeft - 12);
  }
}

/* ---------- Switching views ---------- */

/**
 * Opens a view: updates state, colours, tabs and title, then subscribes to
 * that view's live data. Every data change re-renders the whole view, which
 * is simple and fast enough for a few dozen cards.
 */
export function openView(v) {
  if (VIEWS[v]?.hopOnly && !state.me) v = "plan";   // guests never see HoP views
  state.view = v;

  // <body data-board="…"> switches the colour variables in style.css.
  document.body.dataset.board = v;

  // Keep the URL in sync without adding a browser-history entry
  // (replaceState does not fire "hashchange", so no loop).
  if (location.hash.slice(1) !== v) history.replaceState(null, "", "#" + v);

  renderTabs();
  const title = $("#viewName");
  if (title) title.textContent = VIEWS[v].name;

  // Stop listening to the previous view's data.
  unsub?.(); unsub = null;

  // Show either the masterplan container or the kanban container.
  const isPlan = v === "plan";
  const planBox = $("#plan"), boardBox = $("#board");
  if (planBox) planBox.hidden = !isPlan;
  if (boardBox) boardBox.hidden = isPlan;
  renderBarActions();

  if (isPlan) {
    renderPlan();   // draw immediately with cached data, then update live
    unsub = state.store.subscribePlan(
      list => { state.plan = list; state.planLoaded = true; renderPlan(); },
      e => {
        // Show the reason in the masterplan area too, instead of an endless "Ładowanie…".
        const msg = readErrMsg(e);
        toast(msg);
        const box = $("#plan");
        if (box && !state.planLoaded) box.replaceChildren(el("p", { class: "plan-empty", text: msg }));
      });
  } else {
    state.tasks = [];   // clear the previous board's cards right away
    renderBoard();
    unsub = state.store.subscribeTasks(v, list => { state.tasks = list; renderBoard(); }, e => toast(readErrMsg(e)));
  }
}

// Buttons on the right of the view title. Currently only "+ Dodaj wydarzenie"
// (add event), shown on the masterplan to logged-in HoP members.
export function renderBarActions() {
  const box = $("#barActions");
  if (!box) return;
  box.replaceChildren();
  if (state.view === "plan" && state.me) {
    box.append(el("button", { class: "btn small red", type: "button", text: "+ Dodaj wydarzenie", onclick: () => openEvent(null) }));
  }
}
