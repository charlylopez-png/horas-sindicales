// Backend real: Firebase Authentication + Cloud Firestore
const V = "10.12.2";
const base = `https://www.gstatic.com/firebasejs/${V}`;

export async function createFirebaseBackend(config, opts) {
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const A = await import(`${base}/firebase-auth.js`);
  const F = await import(`${base}/firebase-firestore.js`);

  const app = initializeApp(config);
  const auth = A.getAuth(app);
  auth.languageCode = "es";
  const db = F.getFirestore(app);
  const adminEmails = opts.adminEmails.map(e => e.toLowerCase());

  const snapList = s => s.docs.map(d => ({ id: d.id, ...d.data() }));
  const stamp = () => F.serverTimestamp();

  return {
    mode: "firebase",

    // ---------- Autenticación ----------
    onAuth(cb) {
      return A.onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: u.email } : null));
    },
    login: (email, pw) => A.signInWithEmailAndPassword(auth, email, pw),
    register: (email, pw) => A.createUserWithEmailAndPassword(auth, email, pw),
    logout: () => A.signOut(auth),
    resetPassword: email => A.sendPasswordResetEmail(auth, email),
    async changePassword(current, next) {
      const u = auth.currentUser;
      const cred = A.EmailAuthProvider.credential(u.email, current);
      await A.reauthenticateWithCredential(u, cred);
      await A.updatePassword(u, next);
    },

    // ---------- Perfiles de usuario ----------
    async ensureProfile(user, name) {
      const ref = F.doc(db, "users", user.uid);
      const snap = await F.getDoc(ref);
      if (snap.exists()) return;
      const isAdmin = adminEmails.includes((user.email || "").toLowerCase());
      await F.setDoc(ref, {
        name: name || user.email.split("@")[0],
        email: user.email,
        role: isAdmin ? "admin" : "user",
        active: isAdmin,
        createdAt: stamp()
      });
    },
    onMyProfile(uid, cb, err) {
      return F.onSnapshot(F.doc(db, "users", uid), s => cb(s.exists() ? { id: s.id, ...s.data() } : null), err);
    },
    onUsers(cb, err) {
      return F.onSnapshot(F.collection(db, "users"), s => cb(snapList(s)), err);
    },
    updateUser: (uid, data) => F.updateDoc(F.doc(db, "users", uid), data),

    // ---------- Trabajadores del comité ----------
    onWorkers(cb, err) {
      return F.onSnapshot(F.collection(db, "workers"), s => cb(snapList(s)), err);
    },
    async seedWorkers(names, quota) {
      const existing = await F.getDocs(F.collection(db, "workers"));
      if (!existing.empty) return;
      const batch = F.writeBatch(db);
      names.forEach((name, i) => {
        const id = "w" + String(i + 1).padStart(2, "0");
        batch.set(F.doc(db, "workers", id), { name, quota, active: true, order: i + 1 });
      });
      await batch.commit();
    },
    saveWorker: (id, data) => F.setDoc(F.doc(db, "workers", id), data, { merge: true }),

    // ---------- Anotaciones ----------
    onEntriesMonth(month, cb, err) {
      const q = F.query(F.collection(db, "entries"), F.where("month", "==", month));
      return F.onSnapshot(q, s => cb(snapList(s)), err);
    },
    async getEntriesMonth(month) {
      const q = F.query(F.collection(db, "entries"), F.where("month", "==", month));
      return snapList(await F.getDocs(q));
    },
    async getEntriesRange(fromMonth, toMonth) {
      const q = F.query(F.collection(db, "entries"),
        F.where("month", ">=", fromMonth), F.where("month", "<=", toMonth));
      return snapList(await F.getDocs(q));
    },
    async addEntry(data) {
      await F.addDoc(F.collection(db, "entries"), { ...data, createdAt: stamp() });
    },
    async updateEntry(id, data) {
      await F.updateDoc(F.doc(db, "entries", id), { ...data, updatedAt: stamp() });
    },
    deleteEntry: id => F.deleteDoc(F.doc(db, "entries", id))
  };
}
