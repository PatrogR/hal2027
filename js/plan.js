/**
 * plan.js
 * ---------------------------------------------------------------------------
 * Masterplan: a timeline of events per patrol, in half-month slots,
 * drawn like the original design graphic.
 *
 * Layout model:
 *   - The time range (CONFIG.plan) is split into blocks of `perRow` months
 *     (5 by default → Nov–Mar and Apr–Aug).
 *   - Each block is a CSS grid: column 1 = row labels, column 2 = timeline.
 *     Grid row 1 = month headers, then one grid row per patrol (ROWS).
 *   - Inside each patrol row, events are absolutely positioned in a
 *     ".track" element using percentages (see boxStyle()).
 *   - Events with row "all" and the red "today" line live on a separate
 *     ".plan-layer" that spans all patrol rows.
 *   - An event crossing a block boundary (e.g. March → April) is "clipped"
 *     and drawn once in each block.
 *
 * Everyone can view the masterplan; only logged-in HoP members get clickable
 * events and the "add event" button. Rules enforce the same on the server.
 * ---------------------------------------------------------------------------
 */
import { CONFIG, MONTHS, SLOTS, slotLabel, ROWS, ROW_ALL } from "./config.js";
import { $, el, openModal, deleteButton, quote } from "./ui.js";
import { state, act } from "./state.js";

/* ---------- Layout calculations ---------- */

/**
 * Assigns vertical "lanes" to the events of one patrol row so overlapping
 * events don't cover each other.
 *
 * Input: segments { s, e } (start/end slot, inclusive). The function adds:
 *   x.lane – which lane (0 = top) the event goes in,
 *   x.k    – how many lanes its overlap group ("cluster") needs.
 *
 * Events are grouped into clusters of mutually overlapping events. A lone
 * event gets k = 1 and fills the full row height; two overlapping events get
 * k = 2 and each takes half the height – matching the design, where only
 * overlapping boxes are half-height.
 *
 * Inside a cluster, a greedy algorithm places each event in the first lane
 * that is already free at its start slot.
 *
 * Returns the largest k in the row (used to make very busy rows taller).
 */
export function packRow(segs) {
  // Sort by start; for equal starts put longer events first (looks tidier).
  segs.sort((a, b) => a.s - b.s || b.e - a.e);
  let maxK = 1, i = 0;
  while (i < segs.length) {
    // Grow a cluster while the next event starts before the cluster ends.
    const cluster = [segs[i]];
    let end = segs[i++].e;
    while (i < segs.length && segs[i].s <= end) { cluster.push(segs[i]); end = Math.max(end, segs[i].e); i++; }

    // ends[lane] = last slot occupied in that lane so far.
    const ends = [];
    for (const x of cluster) {
      let lane = ends.findIndex(e => e < x.s);   // first lane free before x starts
      if (lane === -1) { lane = ends.length; ends.push(x.e); } else ends[lane] = x.e;
      x.lane = lane;
    }
    cluster.forEach(x => { x.k = ends.length; });
    maxK = Math.max(maxK, ends.length);
  }
  return maxK;
}

/**
 * Inline CSS that positions an event box inside its track.
 *   s, e  – start/end slot relative to the block (0-based, inclusive),
 *   cols  – number of slots in the block,
 *   lane  – lane index, k – number of lanes in its cluster.
 * Horizontal: slot fractions of the width, minus 4 px gap on each side.
 * Vertical: lane fraction of the height, minus 6 px gap top and bottom.
 */
export function boxStyle(s, e, cols, lane, k) {
  const L = s / cols * 100, W = (e - s + 1) / cols * 100, T = lane / k * 100, H = 100 / k;
  return `left:calc(${L}% + 4px);width:calc(${W}% - 8px);top:calc(${T}% + 6px);height:calc(${H}% - 12px)`;
}

/**
 * Position of "today" on the timeline in MONTHS (fractional), e.g. 0.2 means
 * 20 % into the first month. Uses the real day of the month, so the line
 * moves smoothly rather than jumping between halves.
 * Returns null if today is outside the masterplan range (line not drawn).
 */
export function todayPosition() {
  const d = new Date();
  const i = (d.getFullYear() - CONFIG.plan.startYear) * 12 + d.getMonth() - CONFIG.plan.startMonth;
  if (i < 0 || i >= MONTHS.length) return null;
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();   // day 0 of next month = last day of this one
  return i + (d.getDate() - 1) / days;
}

/* ---------- Rendering ---------- */

// Scroll the timeline to "today" only on the FIRST render of a page visit,
// not on every live update (that would yank the view away while reading).
let scrolledToToday = false;
let activeTimelineMonth = Math.max(0, Math.floor(todayPosition() ?? 0));
let timelineScrollFrame = 0;
let timelineNavigationTimer = 0;

function updateTimelineControls() {
  const controls = $("#planControls");
  if (!controls) return;
  const month = MONTHS[activeTimelineMonth];
  if (!controls.querySelector(".timeline-position")) {
    controls.replaceChildren(
      el("button", { class: "btn ghost small", type: "button", text: "‹", "aria-label": "Poprzedni miesiąc", onclick: () => scrollToTimelineMonth(activeTimelineMonth - 1) }),
      el("span", { class: "timeline-position", "aria-live": "polite" }),
      el("button", { class: "btn ghost small", type: "button", text: "›", "aria-label": "Następny miesiąc", onclick: () => scrollToTimelineMonth(activeTimelineMonth + 1) }),
      el("span", { class: "timeline-hint", text: "Przesuń oś w bok, aby zobaczyć kolejne miesiące." })
    );
  }
  controls.querySelector(".timeline-position").textContent = month ? month.name : "";
  const [previous, next] = controls.querySelectorAll("button");
  previous.disabled = activeTimelineMonth === 0;
  next.disabled = activeTimelineMonth === MONTHS.length - 1;
}

function scrollToTimelineMonth(index) {
  activeTimelineMonth = Math.max(0, Math.min(MONTHS.length - 1, index));
  updateTimelineControls();
  clearTimeout(timelineNavigationTimer);
  timelineNavigationTimer = setTimeout(() => { timelineNavigationTimer = 0; }, 700);
  requestAnimationFrame(() => {
    const root = $("#plan");
    const month = root?.querySelector(`[data-month-index="${activeTimelineMonth}"]`);
    if (!root || !month) return;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = reducedMotion ? "auto" : "smooth";
    const blockRect = month.closest(".plan-half")?.getBoundingClientRect();
    if (blockRect) {
      const verticalDelta = blockRect.top < 0 ? blockRect.top : blockRect.bottom > window.innerHeight ? blockRect.bottom - window.innerHeight : 0;
      if (verticalDelta) window.scrollBy({ top: verticalDelta, behavior });
    }
    const labelWidth = root.querySelector(".rcell")?.offsetWidth || 0;
    const left = month.getBoundingClientRect().left - root.getBoundingClientRect().left + root.scrollLeft - labelWidth;
    if (reducedMotion) root.scrollLeft = left;
    else root.scrollTo({ left, behavior });
  });
}

function updateTimelineMonthFromScroll() {
  if (timelineNavigationTimer) return;
  if (timelineScrollFrame) return;
  timelineScrollFrame = requestAnimationFrame(() => {
    timelineScrollFrame = 0;
    const root = $("#plan");
    if (!root || root.hidden) return;
    const blocks = [...root.querySelectorAll(".plan-half")];
    if (!blocks.length) return;
    const viewportY = window.innerHeight / 2;
    const block = blocks.reduce((best, item) => {
      const rect = item.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - viewportY);
      return distance < best.distance ? { item, distance } : best;
    }, { item: blocks[0], distance: Infinity }).item;
    const labelWidth = root.querySelector(".rcell")?.offsetWidth || 0;
    const focusX = root.getBoundingClientRect().left + labelWidth + 12;
    const months = [...block.querySelectorAll(".month")];
    const current = months.reduce((best, item) => {
      const rect = item.getBoundingClientRect();
      const distance = Math.abs(rect.left + rect.width / 2 - focusX);
      return distance < best.distance ? { item, distance } : best;
    }, { item: months[0], distance: Infinity }).item;
    if (!current) return;
    const nextIndex = Number(current.dataset.monthIndex);
    if (nextIndex !== activeTimelineMonth) {
      activeTimelineMonth = nextIndex;
      updateTimelineControls();
    }
  });
}

$("#plan")?.addEventListener("scroll", updateTimelineMonthFromScroll, { passive: true });
window.addEventListener("scroll", updateTimelineMonthFromScroll, { passive: true });

// One event box, always a <button>:
//   - HoP members: opens the edit dialog,
//   - guests: opens a read-only preview with the full name and dates.
// The preview matters on touch screens, where hover tooltips (title) don't
// exist and long names are cut off inside small boxes.
export function eventNode(ev, cls, style) {
  const props = { class: cls, style, type: "button", title: `${ev.title} (${slotLabel(ev.from)} – ${slotLabel(ev.to)})` };
  const label = el("span", { text: ev.title });   // span allows 2-line clamping in CSS
  return el("button", { ...props, onclick: () => (state.me ? openEvent(ev) : openEventInfo(ev)) }, label);
}

// Draws the whole masterplan from state.plan. Called on every data change.
export function renderPlan() {
  const root = $("#plan");
  if (!root) return;
  root.replaceChildren();
  updateTimelineControls();
  // Before the first data arrives (slow connection) say "loading" rather
  // than wrongly claiming the masterplan is empty.
  if (!state.planLoaded) {
    root.append(el("p", { class: "plan-empty", text: "Ładowanie…" }));
  } else if (!state.plan.length) {
    root.append(el("p", { class: "plan-empty", text: state.me ? "Masterplan jest pusty. Dodaj pierwsze wydarzenie." : "Masterplan jest jeszcze pusty." }));
  }
  const per = CONFIG.plan.perRow;
  const now = todayPosition();

  // One iteration per block of `per` months (h = block index).
  for (let h = 0; h * per < MONTHS.length; h++) {
    const ms = MONTHS.slice(h * per, h * per + per);       // months in this block
    const off = h * per * 2, cols = ms.length * 2, last = off + cols - 1;   // first slot, slot count, last slot

    // Cut an event down to the part that falls inside this block.
    const clip = ev => ({ ev, s: Math.max(ev.from, off), e: Math.min(ev.to, last) });
    const visible = x => x.s <= x.e;   // false if the event is entirely outside the block

    // Prepare each patrol row: its events, lanes and height. Rows are at
    // least 88 px; a row needing 3+ lanes grows by 40 px per lane.
    const touchLayout = matchMedia("(max-width: 720px), (pointer: coarse)").matches;
    const rows = ROWS.map(r => {
      const segs = state.plan.filter(ev => ev.row === r.id).map(clip).filter(visible);
      const k = packRow(segs);
      return { r, segs, height: Math.max(touchLayout ? 104 : 88, k * (touchLayout ? 56 : 40) + 12) };
    });

    // Block grid: row 1 auto height (month headers), then the patrol rows.
    const grid = el("div", {
      class: "plan-half",
      style: `grid-template-rows:auto ${rows.map(x => x.height + "px").join(" ")};--slots:${ms.length * 2};--month-width:${100 / ms.length}%;--slot-width:${50 / ms.length}%`
    });
    const monthHeader = el("div", { class: "months", style: `--n:${ms.length}` },
      ...ms.map((m, j) => el("div", {
        class: "month", "data-month-index": String(h * per + j), style: "grid-column:span 2", text: m.name
      })));
    grid.append(monthHeader);

    rows.forEach(({ r, segs }, ri) => {
      const gr = `grid-row:${ri + 2}`;
      // Three elements share the same grid row:
      //   .band   – full-width background stripe (alternating grey/white),
      //   .rlabel – coloured patrol label on the left,
      //   .track  – positioning context for the event boxes.
      grid.append(el("div", { class: "band", "data-row": r.id, style: gr }));
      // .rcell is the sticky (pinned-left) wrapper; .rlabel is the coloured pill.
      grid.append(el("div", { class: "rcell", "data-row": r.id, style: gr },
        el("div", { class: "rlabel" },
          el("span", { class: "rlabel-full", text: r.label }),
          el("span", { class: "rlabel-mobile", text: r.id === "organizacja" ? "Org." : r.label })
        )
      ));
      const track = el("div", { class: "track", "data-row": r.id, style: gr });
      segs.forEach(x => track.append(eventNode(x.ev, "ev", boxStyle(x.s - off, x.e - off, cols, x.lane, x.k))));
      grid.append(track);
    });

    // Overlay across all patrol rows: big "all patrols" blocks + today line.
    const layer = el("div", { class: "plan-layer", style: `grid-row:2 / span ${ROWS.length}` });
    state.plan.filter(ev => ev.row === "all").map(clip).filter(visible)
      .forEach(x => layer.append(eventNode(x.ev, "ev ev-all", boxStyle(x.s - off, x.e - off, cols, 0, 1))));
    if (now != null && now >= h * per && now < h * per + ms.length) {
      layer.append(el("div", { class: "today", style: `left:${(now - h * per) / ms.length * 100}%`, title: "Dziś" }, el("span", { text: "dziś" })));
    }
    grid.append(layer);
    root.append(grid);
  }

  // On narrow screens the timeline is wider than the screen: on the first
  // render, scroll it so that today's line is visible just right of the
  // pinned labels. Needs a frame so the browser has computed the layout.
  if (!scrolledToToday && now != null) {
    scrolledToToday = true;
    activeTimelineMonth = Math.floor(now);
    updateTimelineControls();
    requestAnimationFrame(() => {
      const line = root.querySelector(".today");
      if (!line || root.scrollWidth <= root.clientWidth) return;
      const labelWidth = root.querySelector(".rcell")?.offsetWidth || 0;
      const x = line.getBoundingClientRect().left - root.getBoundingClientRect().left + root.scrollLeft;
      root.scrollLeft = Math.max(0, x - labelWidth - 24);
    });
  }
}

/* ---------- Read-only event preview (guests) ---------- */

// Shows the full event name, patrol and time range. Used by guests, who
// cannot edit, mainly so they can read long names on phones.
export function openEventInfo(ev) {
  const row = [...ROWS, ROW_ALL].find(r => r.id === ev.row);
  let close;
  const box = el("div", { "aria-labelledby": "i-h" },
    el("h2", { id: "i-h", text: ev.title }),
    el("p", { class: "hint", text: row ? row.label : "" }),
    el("p", { text: `Od: ${slotLabel(ev.from)}` }),
    el("p", { text: `Do: ${slotLabel(ev.to)}` }),
    el("div", { class: "actions" },
      el("button", { class: "btn", type: "button", text: "Zamknij", onclick: () => close() }))
  );
  close = openModal(box);
}

/* ---------- Event dialog ---------- */

/**
 * Add/edit dialog for a masterplan event (HoP only).
 *   ev = null   → new event,
 *   ev = object → edit that event (with a delete button).
 * Dates are chosen as half-month slots (From/To dropdowns).
 * Values are stored as integers – firestore.rules require `int`.
 * The dialog closes immediately after saving (optimistic UI): Firestore
 * shows the change at once and syncs in the background; errors appear as a toast.
 */
export function openEvent(ev) {
  if (!state.me) return;
  const isNew = !ev;
  const slotOptions = sel => Array.from({ length: SLOTS }, (_, i) => el("option", { value: String(i), selected: i === sel }, slotLabel(i)));
  const titleIn = el("input", { id: "e-title", maxlength: "120", required: true, value: ev?.title || "" });
  const rowIn = el("select", { id: "e-row" },
    ...[...ROWS, ROW_ALL].map(r => el("option", { value: r.id, selected: r.id === (ev?.row || "program") }, r.label)));
  const fromIn = el("select", { id: "e-from" }, ...slotOptions(ev?.from ?? 0));
  const toIn = el("select", { id: "e-to" }, ...slotOptions(ev?.to ?? 1));
  const err = el("p", { class: "err" });
  let close;

  const form = el("form", {
    "aria-labelledby": "e-h",
    onsubmit: e => {
      e.preventDefault();
      const data = { title: titleIn.value.trim(), row: rowIn.value, from: parseInt(fromIn.value, 10), to: parseInt(toIn.value, 10) };
      // Client-side checks for friendly messages; the rules check again.
      if (!data.title) { err.textContent = "Wpisz nazwę wydarzenia."; titleIn.focus(); return; }
      if (data.to < data.from) { err.textContent = "Koniec nie może być wcześniej niż początek."; toIn.focus(); return; }
      const label = quote(data.title);
      act(isNew ? state.store.addEvent(data) : state.store.updateEvent(ev.id, data), isNew ? "Dodanie wydarzenia" : "Edycja wydarzenia", label).catch(() => {});
      close();
    }
  },
    el("h2", { id: "e-h", text: isNew ? "Nowe wydarzenie" : "Edytuj wydarzenie" }),
    el("label", { for: "e-title", text: "Nazwa" }), titleIn,
    el("label", { for: "e-row", text: "Patrol" }), rowIn,
    el("div", { class: "row2" },
      el("div", {}, el("label", { for: "e-from", text: "Od" }), fromIn),
      el("div", {}, el("label", { for: "e-to", text: "Do" }), toIn)
    ),
    err,
    el("div", { class: "actions" },
      isNew ? null : deleteButton(() => { act(state.store.removeEvent(ev.id), "Usunięcie wydarzenia", quote(ev.title)).catch(() => {}); close(); }),
      el("button", { class: "btn ghost", type: "button", text: "Anuluj", onclick: () => close() }),
      el("button", { class: "btn red", type: "submit", text: isNew ? "Dodaj wydarzenie" : "Zapisz zmiany" })
    )
  );
  close = openModal(form, { red: true });
}
