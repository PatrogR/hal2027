/**
 * store/firebase.js
 * ---------------------------------------------------------------------------
 * Data store backed by Firebase (Cloud Firestore + Firebase Authentication).
 *
 * The rest of the app never talks to Firebase directly – it only calls the
 * methods of the object returned by createFirebaseStore(). store/demo.js
 * returns an object with EXACTLY the same methods, so the app works the same
 * in demo mode. If you add a method here, add it to demo.js too.
 *
 * Firestore data model:
 *   boards/{boardId}/tasks/{taskId}
 *       title, description, owner, deadline ("YYYY-MM-DD" or ""), column,
 *       order (number used for sorting), createdAt, updatedAt
 *   plan/{eventId}      title, row (program|kwaterka|organizacja|all), from, to (slot numbers)
 *   members/{uid}       login, role (hop|admin), active (bool), createdAt
 *   logs/{logId}        uid, login, action, details, at
 *
 * Who may read/write what is decided ONLY by firestore.rules, not here.
 * ---------------------------------------------------------------------------
 */
import { CONFIG, FIREBASE_VERSION, toEmail } from "../config.js";

export async function createFirebaseStore() {
  // Load the three Firebase SDK modules straight from Google's CDN.
  // No build step / npm needed – the browser imports them as ES modules.
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
  const [A, F, U] = await Promise.all([
    import(base + "firebase-app.js"),        // A = app core
    import(base + "firebase-firestore.js"),  // F = database
    import(base + "firebase-auth.js")        // U = user authentication
  ]);
  const app = A.initializeApp(CONFIG.firebase);
  const db = F.getFirestore(app);
  const auth = U.getAuth(app);

  // Login session lasts only until the browser tab is closed (sessionStorage).
  // If the browser blocks storage (possible inside a sandboxed SharePoint
  // iframe), fall back to memory only: the user stays logged in until reload.
  try { await U.setPersistence(auth, U.browserSessionPersistence); }
  catch { await U.setPersistence(auth, U.inMemoryPersistence); }

  // Server timestamp: the time is set by Google's servers, not the user's
  // clock (which may be wrong or manipulated).
  const ts = F.serverTimestamp;

  // Reference to the task collection of one board, e.g. boards/program/tasks.
  const tasksCol = b => F.collection(db, "boards", b, "tasks");

  // Live subscription helper. Firestore calls `on` immediately with the
  // current data and again after EVERY change (including other people's).
  // Each document is flattened to { id, ...fields }.
  // Returns an unsubscribe function – call it to stop listening.
  const live = (q, on, err) => F.onSnapshot(q, s => on(s.docs.map(d => ({ id: d.id, ...d.data() }))), err);

  // Reads members/{uid} for a signed-in Firebase user and returns
  // { uid, login, role } if the account is an ACTIVE HoP member, else null.
  // A Firebase Auth account alone is not enough to be HoP: the member
  // document is what grants access (and firestore.rules check the same doc).
  async function loadMember(user) {
    try {
      const s = await F.getDoc(F.doc(db, "members", user.uid));
      if (!s.exists()) return null;
      const d = s.data();
      return d.active ? { uid: user.uid, login: d.login, role: d.role } : null;
    } catch { return null; }
  }

  return {
    /* ---------- Kanban tasks ---------- */

    // Live list of a board's tasks, sorted by `order`.
    subscribeTasks: (b, on, err) => live(F.query(tasksCol(b), F.orderBy("order")), on, err),
    // Creates a task; Firestore generates the id.
    addTask: (b, t) => F.addDoc(tasksCol(b), { ...t, createdAt: ts(), updatedAt: ts() }),
    // Partial update: only the given fields change (e.g. { column, order } on drag).
    updateTask: (b, id, t) => F.updateDoc(F.doc(db, "boards", b, "tasks", id), { ...t, updatedAt: ts() }),
    removeTask: (b, id) => F.deleteDoc(F.doc(db, "boards", b, "tasks", id)),

    /* ---------- Masterplan events ---------- */

    // Live list of all events (unsorted; the layout code sorts them itself).
    subscribePlan: (on, err) => live(F.collection(db, "plan"), on, err),
    addEvent: e => F.addDoc(F.collection(db, "plan"), e),
    updateEvent: (id, e) => F.updateDoc(F.doc(db, "plan", id), e),
    removeEvent: id => F.deleteDoc(F.doc(db, "plan", id)),

    /* ---------- Authentication ---------- */

    // Logs in with login + password. Throws on wrong credentials. If the
    // password is right but the account is not an active member, signs out
    // again immediately and throws { code: "no-access" }.
    async signIn(login, pwd) {
      const cred = await U.signInWithEmailAndPassword(auth, toEmail(login), pwd);
      const m = await loadMember(cred.user);
      if (!m) { await U.signOut(auth); throw { code: "no-access" }; }
      return m;
    },
    signOut: () => U.signOut(auth),

    // Registers a callback for login state changes: cb(member) after login
    // (also when a session is restored on page reload), cb(null) after logout.
    // Non-members are signed out silently, which then triggers cb(null).
    onAuth(cb) {
      U.onAuthStateChanged(auth, async user => {
        if (!user) return cb(null);
        const m = await loadMember(user);
        if (!m) { await U.signOut(auth); return; }
        cb(m);
      });
    },

    // Changes the CURRENT user's password (only offered to the admin in the UI).
    // Firebase requires a recent login for this, so we re-authenticate with
    // the current password first – which also verifies the user knows it.
    async changePassword(current, next) {
      const u = auth.currentUser;
      await U.reauthenticateWithCredential(u, U.EmailAuthProvider.credential(u.email, current));
      await U.updatePassword(u, next);
    },

    /* ---------- Member management (admin only, enforced by rules) ---------- */

    // Live list of all member documents, sorted by login.
    subscribeMembers: (on, err) => live(F.query(F.collection(db, "members"), F.orderBy("login")), on, err),

    // Creates a new HoP account. Problem: createUserWithEmailAndPassword()
    // automatically signs in as the NEW user, which would log the admin out.
    // Solution: create the account through a temporary second Firebase app
    // instance with its own, in-memory auth session, then throw it away.
    // The members/{uid} document is written through the main instance, i.e.
    // as the admin – that is what firestore.rules require.
    async createMember(login, pwd, role) {
      const sec = A.initializeApp(CONFIG.firebase, "admin-create-" + Date.now());
      try {
        const sa = U.getAuth(sec);
        await U.setPersistence(sa, U.inMemoryPersistence);
        const cred = await U.createUserWithEmailAndPassword(sa, toEmail(login), pwd);
        await F.setDoc(F.doc(db, "members", cred.user.uid), { login, role, active: true, createdAt: ts() });
        await U.signOut(sa);
      } finally {
        await A.deleteApp(sec);   // always clean up the temporary instance
      }
    },

    // Activates/deactivates an account. Deactivation takes effect immediately:
    // firestore.rules check `active` on every request.
    setMemberActive: (uid, active) => F.updateDoc(F.doc(db, "members", uid), { active }),

    /* ---------- Activity log ---------- */

    // Appends one log entry for member `m`. Rules require uid/login to match
    // the signed-in user and `at` to be the server time.
    log: (m, action, details) => F.addDoc(F.collection(db, "logs"), { uid: m.uid, login: m.login, action, details, at: ts() }),
    // Live list of the newest 300 log entries (readable by admins only).
    subscribeLogs: (on, err) => live(F.query(F.collection(db, "logs"), F.orderBy("at", "desc"), F.limit(300)), on, err)
  };
}
