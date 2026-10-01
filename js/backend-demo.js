// Backend de DEMOSTRACIÓN: guarda todo en el navegador (localStorage).
// Solo para probar la app sin Firebase. No usar con datos reales.
const KEY = "horas_sindicales_demo_v1";

export function createDemoBackend(opts) {
  const adminEmails = opts.adminEmails.map(e => e.toLowerCase());
  let db = load();
  const subs = new Set();
  let authCb = null;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* sin almacenamiento */ }
    return { users: {}, workers: {}, entries: {}, session: null, seq: 1 };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* ignorar */ }
    subs.forEach(fn => fn());
  }
  const err = code => Object.assign(new Error(code), { code });
  const delay = v => new Promise(r => setTimeout(() => r(v), 60));
  const sub = fn => { subs.add(fn); fn(); return () => subs.delete(fn); };
  const list = o => Object.entries(o).map(([id, v]) => ({ id, ...v }));
  const newId = () => "d" + (db.seq++) + Math.random().toString(36).slice(2, 6);
  const current = () => db.session && db.users[db.session] ? { uid: db.session, email: db.users[db.session].email } : null;
  const fireAuth = () => authCb && authCb(current());

  return {
    mode: "demo",
    onAuth(cb) { authCb = cb; setTimeout(fireAuth, 0); return () => (authCb = null); },
    async login(email, pw) {
      const u = Object.entries(db.users).find(([, v]) => v.email === email.toLowerCase());
      if (!u) throw err("auth/invalid-credential");
      if (u[1].pw !== pw) throw err("auth/invalid-credential");
      db.session = u[0]; save(); fireAuth(); return delay();
    },
    async register(email, pw) {
      email = email.toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) throw err("auth/invalid-email");
      if (pw.length < 6) throw err("auth/weak-password");
      if (Object.values(db.users).some(v => v.email === email)) throw err("auth/email-already-in-use");
      const uid = newId();
      db.users[uid] = { email, pw };
      db.session = uid; save(); fireAuth(); return delay();
    },
    async logout() { db.session = null; save(); fireAuth(); },
    async resetPassword(email) {
      // En demo no se envía correo: se simula
      return delay();
    },
    async changePassword(currentPw, next) {
      const u = db.users[db.session];
      if (u.pw !== currentPw) throw err("auth/invalid-credential");
      if (next.length < 6) throw err("auth/weak-password");
      u.pw = next; save(); return delay();
    },

    async ensureProfile(user, name) {
      const u = db.users[user.uid];
      if (u.role) return;
      const isAdmin = adminEmails.includes(u.email);
      Object.assign(u, { name: name || u.email.split("@")[0], role: isAdmin ? "admin" : "user", active: isAdmin, createdAt: Date.now() });
      save();
    },
    onMyProfile(uid, cb) {
      return sub(() => {
        const u = db.users[uid];
        cb(u && u.role ? { id: uid, name: u.name, email: u.email, role: u.role, active: u.active } : null);
      });
    },
    onUsers(cb) {
      return sub(() => cb(list(db.users).filter(u => u.role).map(({ pw, ...u }) => u)));
    },
    async updateUser(uid, data) { Object.assign(db.users[uid], data); save(); },

    onWorkers(cb) { return sub(() => cb(list(db.workers))); },
    async seedWorkers(names, quota) {
      if (Object.keys(db.workers).length) return;
      names.forEach((name, i) => {
        db.workers["w" + String(i + 1).padStart(2, "0")] = { name, quota, active: true, order: i + 1 };
      });
      save();
    },
    async saveWorker(id, data) { db.workers[id] = { ...(db.workers[id] || {}), ...data }; save(); },

    onEntriesMonth(month, cb) { return sub(() => cb(list(db.entries).filter(e => e.month === month))); },
    async getEntriesMonth(month) { return list(db.entries).filter(e => e.month === month); },
    async getEntriesRange(a, b) { return list(db.entries).filter(e => e.month >= a && e.month <= b); },
    async addEntry(data) { db.entries[newId()] = { ...data, createdAt: Date.now() }; save(); return delay(); },
    async updateEntry(id, data) { db.entries[id] = { ...db.entries[id], ...data, updatedAt: Date.now() }; save(); return delay(); },
    async deleteEntry(id) { delete db.entries[id]; save(); }
  };
}
