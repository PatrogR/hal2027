/**
 * kanban.js
 * ---------------------------------------------------------------------------
 * Kanban boards: columns, task cards, drag & drop, deadlines, task dialog.
 *
 * The same code serves all four boards (three patrols + Patrolowa); the open board
 * is state.view and its tasks are in state.tasks (sorted by `order`).
 *
 * Ordering: each task has a numeric `order`. New tasks go to the end
 * (last + 1000). A card dropped between two cards gets the average of their
 * orders, so a move updates only ONE document. Gaps of 1000 allow many
 * insertions before numbers get too close (floating point copes with ~50
 * halvings in the same spot, far more than needed here).
 * ---------------------------------------------------------------------------
 */
import { VIEWS, COLUMNS } from "./config.js";
import { $, el, toast, errMsg, openModal, deleteButton, quote } from "./ui.js";
import { state, act } from "./state.js";

// ID of the card currently being dragged (null when not dragging). Used to
// ignore drags of other things, e.g. text or files dropped onto the board.
let dragId = null;
let activeColumnIndex = 0;

/* ---------- Rendering ---------- */

// Draws the whole board from state.tasks: one <section> per column with a
// header (name + count), the card list and a "+ Dodaj zadanie" (add) button.
export function renderBoard() {
  const root = $("#board");
  if (!root) return;
  const controls = $("#boardControls");
  if (controls) {
    controls.replaceChildren(
      el("button", { class: "btn ghost small", type: "button", text: "‹", "aria-label": "Poprzednia kolumna", onclick: () => scrollBoardColumn(activeColumnIndex - 1) }),
      el("span", { class: "board-position", "aria-live": "polite" }),
      el("button", { class: "btn ghost small", type: "button", text: "›", "aria-label": "Następna kolumna", onclick: () => scrollBoardColumn(activeColumnIndex + 1) })
    );
  }
  if (!root.dataset.mobileControlsBound) {
    root.addEventListener("scroll", updateActiveColumn, { passive: true });
    root.dataset.mobileControlsBound = "true";
  }
  root.replaceChildren();
  for (const c of COLUMNS) {
    const items = state.tasks.filter(t => t.column === c.id);
    const list = el("div", { class: "list", "data-col": c.id });
    items.forEach(t => list.append(cardEl(t)));
    bindDrop(list);
    root.append(el("section", { class: "col", "data-col": c.id, "aria-label": c.name },
      el("h3", { class: "col-head" }, c.name, el("span", { class: "count", text: String(items.length) })),
      list,
      state.me || c.id !== "done"
        ? el("button", { class: "add", type: "button", text: "+ Dodaj zadanie", onclick: () => openTask(null, c.id) })
        : null
    ));
  }
  updateActiveColumn();
}

function updateActiveColumn() {
  const root = $("#board"), controls = $("#boardControls");
  if (!root || !controls) return;
  const columns = [...root.querySelectorAll(".col")];
  if (!columns.length) return;
  const center = root.getBoundingClientRect().left + root.clientWidth / 2;
  activeColumnIndex = columns.reduce((best, column, index) => {
    const rect = column.getBoundingClientRect();
    const distance = Math.abs(rect.left + rect.width / 2 - center);
    return distance < best.distance ? { index, distance } : best;
  }, { index: 0, distance: Infinity }).index;
  controls.querySelector(".board-position")?.replaceChildren(
    document.createTextNode(`${activeColumnIndex + 1} z ${columns.length} · ${COLUMNS[activeColumnIndex].name}`)
  );
  const [previous, next] = controls.querySelectorAll("button");
  if (previous) previous.disabled = activeColumnIndex === 0;
  if (next) next.disabled = activeColumnIndex === columns.length - 1;
}

function scrollBoardColumn(index) {
  const root = $("#board"), columns = root ? [...root.querySelectorAll(".col")] : [];
  if (!root || !columns.length) return;
  activeColumnIndex = Math.max(0, Math.min(columns.length - 1, index));
  const left = columns[activeColumnIndex].getBoundingClientRect().left - root.getBoundingClientRect().left + root.scrollLeft - 12;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) root.scrollLeft = left;
  else root.scrollTo({ left, behavior: "smooth" });
  updateActiveColumn();
}

/**
 * One task card. The card itself remains draggable, while its title is a
 * regular button so it can be opened with a keyboard without nesting controls.
 * Deadline state ("soon"/"overdue") is added to the deadline label for colouring.
 */
export function cardEl(t) {
  const due = deadlineState(t);
  const card = el("div", {
    class: `card ${due}`.trim(), draggable: state.me || t.column !== "done" ? "true" : "false", "data-id": t.id,
    onclick: e => { if (!e.target.closest("button")) openTask(t); },
    ondragstart: e => { dragId = t.id; card.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", t.id); },
    ondragend: () => { dragId = null; card.classList.remove("dragging"); clearMarks(); }
  },
    el("h3", {}, el("button", { class: "card-title", type: "button", text: t.title, onclick: () => openTask(t), "aria-label": `Edytuj zadanie: ${t.title}` })),
    t.description ? el("p", { text: t.description }) : null,
    // .meta is hidden by CSS when empty (no owner and no deadline).
    el("div", { class: "meta" },
      t.owner ? el("div", { class: "owner", text: t.owner }) : null,
      t.deadline ? el("span", { class: `due ${due}`.trim(), text: `${due === "overdue" ? "Po terminie" : "Deadline"}: ${fmtDate(t.deadline)}` }) : null),
    state.me && t.column === "review"
      ? el("button", {
        class: "btn small approve-task", type: "button", text: "Zatwierdź",
        onclick: e => {
          e.stopPropagation();
          act(
            state.store.updateTask(state.view, t.id, { column: "done", order: endOrder("done") }),
            "Zatwierdzenie zadania",
            `${VIEWS[state.view].name}: ${quote(t.title)}`
          ).catch(() => {});
        }
      })
      : null
  );
  return card;
}

/* ---------- Drag & drop (desktop) ----------
 * Uses the native HTML5 drag-and-drop API. It does not work with touch, so on
 * phones cards can be moved through the task dialog.
 */

// Removes the blue/coloured insertion line(s) shown while dragging.
export function clearMarks() { document.querySelectorAll(".drop-mark").forEach(m => m.remove()); }

// Where in `list` a card dropped at vertical mouse position `y` should go:
// before the first card whose middle is below the mouse, else at the end.
// The dragged card itself is ignored.
export function dropIndex(list, y) {
  const cards = [...list.querySelectorAll(".card:not(.dragging)")];
  const i = cards.findIndex(c => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
  return i === -1 ? cards.length : i;
}

// Makes a column's card list a drop target.
export function bindDrop(list) {
  // While dragging over the list: allow dropping (preventDefault) and show
  // an insertion line where the card would land.
  list.addEventListener("dragover", e => {
    if (!dragId || (!state.me && list.dataset.col === "done")) return;
    e.preventDefault();
    clearMarks();
    const cards = [...list.querySelectorAll(".card:not(.dragging)")];
    const i = dropIndex(list, e.clientY);
    const mark = el("div", { class: "drop-mark" });
    cards[i] ? list.insertBefore(mark, cards[i]) : list.append(mark);
  });
  // Leaving the list (not just moving between its children) hides the line.
  list.addEventListener("dragleave", e => { if (!list.contains(e.relatedTarget)) clearMarks(); });

  // Drop: compute the new column and order, then save.
  list.addEventListener("drop", e => {
    e.preventDefault();
    const id = dragId; if (!id) return;
    const column = list.dataset.col;
    if (!state.me && column === "done") return;
    const i = dropIndex(list, e.clientY);
    clearMarks();

    // Neighbours in the target column (excluding the dragged card itself).
    const siblings = state.tasks.filter(t => t.column === column && t.id !== id);
    const prev = siblings[i - 1], next = siblings[i];
    // Between two cards → average; at the end → after last; at the top →
    // before first; empty column → 1000.
    const order = prev && next ? (prev.order + next.order) / 2 : prev ? prev.order + 1000 : next ? next.order - 1000 : 1000;

    const task = state.tasks.find(t => t.id === id);
    if (!task || (task.column === column && task.order === order)) return;   // nothing changed
    const moved = task.column !== column;
    const p = state.store.updateTask(state.view, id, { column, order });
    // Only column changes go to the activity log; reordering within a column
    // would just flood the log.
    if (moved) act(p, "Przeniesienie zadania", `${VIEWS[state.view].name}: ${quote(task.title)} do kolumny ${COLUMNS.find(c => c.id === column).name}`).catch(() => {});
    else p.catch(err => toast(errMsg(err)));
  });
}

/* ---------- Deadlines ----------
 * Deadlines are stored as "YYYY-MM-DD" strings (the value format of
 * <input type="date">). Strings in this format compare correctly with < and >,
 * and avoid time-zone problems that Date objects would bring.
 */

// Date → "YYYY-MM-DD" in the user's LOCAL time zone
// (toISOString() would use UTC and could shift the day).
export const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// "2027-03-14" → "14.03.2027" (Polish date format) for display.
export const fmtDate = iso => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };

// Returns "overdue" (deadline passed), "soon" (within the next 3 days,
// including today) or "" (no deadline, far away, or task already done).
export function deadlineState(t) {
  if (!t.deadline || t.column === "done") return "";
  const today = new Date(), soon = new Date();
  soon.setDate(soon.getDate() + 3);
  if (t.deadline < isoLocal(today)) return "overdue";
  if (t.deadline <= isoLocal(soon)) return "soon";
  return "";
}

// Order value that puts a task at the end of `column`.
export const endOrder = column => Math.max(0, ...state.tasks.filter(t => t.column === column).map(t => t.order)) + 1000;

/* ---------- Task dialog ---------- */

/**
 * Add/edit dialog for a task.
 *   task = null   → new task in `presetColumn` (the column whose "+" was clicked),
 *   task = object → edit that task (with a delete button).
 * The board is captured at open time (`board`), so the save goes to the
 * right board even if the view changes while the dialog is open.
 * Field length limits match firestore.rules (title 200, description 5000,
 * owner 100). The dialog closes immediately after saving (optimistic UI).
 */
export function openTask(task, presetColumn) {
  const isNew = !task;
  const board = state.view;
  const titleIn = el("input", { id: "f-title", maxlength: "200", required: true, value: task?.title || "" });
  const descIn = el("textarea", { id: "f-desc", maxlength: "5000" });
  descIn.value = task?.description || "";   // textarea content is set via .value, not an attribute
  const ownerIn = el("input", { id: "f-owner", maxlength: "100", value: task?.owner || "" });
  const deadlineIn = el("input", { id: "f-deadline", type: "date", value: task?.deadline || "" });
  const isMember = !!state.me;
  const defaultColumn = !isMember && presetColumn === "done" ? "todo" : task?.column || presetColumn;
  const colOptions = COLUMNS.filter(c => isMember || c.id !== "done" || task?.column === "done");
  const colIn = el("select", { id: "f-col", disabled: !isMember && task?.column === "done" },
    ...colOptions.map(c => el("option", { value: c.id, selected: c.id === defaultColumn }, c.name)));
  const err = el("p", { class: "err" });
  const saveWarning = el("div", { class: "save-warning", role: "alert", hidden: true },
    el("strong", { text: "Czy na pewno zapisać?" }),
    el("p", { text: "Nie będziesz mógł po tym już usunąć zadania." }),
    el("div", { class: "actions" },
      el("button", { class: "btn ghost", type: "button", text: "Wróć do edycji", onclick: () => { saveWarning.hidden = true; titleIn.focus(); } }),
      el("button", { class: "btn", type: "button", text: "Tak, zapisz zadanie", onclick: () => saveTask() })
    )
  );
  let close;
  const where = VIEWS[board].name;   // board name for the activity log

  const saveTask = () => {
    const title = titleIn.value.trim();
    if (!title) { err.textContent = "Wpisz tytuł zadania."; titleIn.focus(); return; }
    const data = { title, description: descIn.value.trim(), owner: ownerIn.value.trim(), deadline: deadlineIn.value || "", column: colIn.value };
    if (isNew || data.column !== task.column) data.order = endOrder(data.column);
    act(isNew ? state.store.addTask(board, data) : state.store.updateTask(board, task.id, data),
      isNew ? "Dodanie zadania" : "Edycja zadania", `${where}: ${quote(title)}`).catch(() => {});
    close();
  };

  const form = el("form", {
    "aria-labelledby": "m-title",
    onsubmit: e => {
      e.preventDefault();
      if (!titleIn.value.trim()) { err.textContent = "Wpisz tytuł zadania."; titleIn.focus(); return; }
      if (isNew && !isMember) { saveWarning.hidden = false; saveWarning.querySelector("button:last-child").focus(); return; }
      saveTask();
    }
  },
    el("h2", { id: "m-title", text: isNew ? "Nowe zadanie" : "Edytuj zadanie" }),
    el("label", { for: "f-title", text: "Tytuł" }), titleIn,
    el("label", { for: "f-desc", text: "Opis" }), descIn,
    el("div", { class: "row2" },
      el("div", {}, el("label", { for: "f-owner", text: "Osoba odpowiedzialna" }), ownerIn),
      el("div", {}, el("label", { for: "f-deadline", text: "Deadline (opcjonalnie)" }), deadlineIn)),
    el("label", { for: "f-col", text: "Kolumna" }), colIn,
    err,
    saveWarning,
    el("div", { class: "actions" },
      !isNew && isMember && task.column === "done"
        ? el("button", {
          class: "btn ghost", type: "button", text: "Anuluj zatwierdzenie",
          onclick: () => {
            act(
              state.store.updateTask(board, task.id, { column: "review", order: endOrder("review") }),
              "Anulowanie zatwierdzenia zadania",
              `${where}: ${quote(task.title)}`
            ).catch(() => {});
            close();
          }
        })
        : null,
      isNew || !isMember ? null : deleteButton(() => { act(state.store.removeTask(board, task.id), "Usunięcie zadania", `${where}: ${quote(task.title)}`).catch(() => {}); close(); }),
      el("button", { class: "btn ghost", type: "button", text: "Anuluj", onclick: () => close() }),
      el("button", { class: "btn", type: "submit", text: isNew ? "Dodaj zadanie" : "Zapisz zmiany" })
    )
  );
  close = openModal(form);
}
