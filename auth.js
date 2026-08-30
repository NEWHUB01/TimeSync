/* =========================================================
   TimeSync — auth.js
   ล็อกแอปด้วยชื่อผู้ใช้ + รหัสผ่าน "เฉพาะในเครื่องนี้"

   ⚠️ ขอบเขตที่ต้องเข้าใจให้ตรงกัน:
   แอปนี้ไม่มีเซิร์ฟเวอร์ ทุกอย่างอยู่ในเครื่องผู้ใช้ การล็อกอินนี้จึงเป็น
   "ล็อกหน้าจอของแอปในเครื่องนี้" ไม่ใช่บัญชีออนไลน์ — กันคนอื่นที่หยิบเครื่อง
   ไปเปิดดูข้อมูลการนอนแบบผ่าน ๆ ได้ แต่กันคนที่เปิด DevTools ไม่ได้

   สิ่งที่ทำได้และทำแล้ว: ไม่เก็บรหัสผ่านจริงเลย เก็บเฉพาะค่าแฮช PBKDF2-SHA256
   (150,000 รอบ + salt สุ่ม 16 ไบต์) ต่อให้มีคนอ่าน localStorage ก็ไม่เห็นรหัส
   ========================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TimeSyncAuth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KEY = 'timesync.auth';
  const SESSION_KEY = 'timesync.session';
  const ITERATIONS = 150000;

  const enc = new TextEncoder();
  const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const fromHex = hex => new Uint8Array((hex.match(/.{2}/g) || []).map(h => parseInt(h, 16)));

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
  }
  function write(v) {
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* โหมดส่วนตัว/พื้นที่เต็ม */ }
  }

  /** PBKDF2-SHA256 → hex — ช้าโดยตั้งใจ เพื่อให้เดารหัสทีละตัวไม่คุ้ม */
  async function hash(password, saltBytes) {
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBytes, iterations: ITERATIONS, hash: 'SHA-256' },
      keyMaterial, 256
    );
    return toHex(bits);
  }

  /** เทียบแบบใช้เวลาคงที่ กันการเดาจากเวลาที่ใช้ตอบ */
  function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  const MIN_PASSWORD = 4;

  return {
    MIN_PASSWORD,

    /** ตั้งรหัสไว้แล้วหรือยัง */
    hasAccount() {
      const a = read();
      return !!(a && a.hash && a.salt);
    },

    username() {
      const a = read();
      return (a && a.username) || '';
    },

    /** สร้างรหัสครั้งแรก */
    async signUp(username, password) {
      const name = String(username || '').trim().slice(0, 40);
      if (!name) throw new Error('กรุณาตั้งชื่อผู้ใช้');
      if (String(password || '').length < MIN_PASSWORD) {
        throw new Error(`รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัว`);
      }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      write({
        username: name,
        salt: toHex(salt),
        hash: await hash(password, salt),
        iterations: ITERATIONS,
        createdAt: new Date().toISOString(),
      });
      return name;
    },

    /** ตรวจรหัสผ่าน */
    async verify(password) {
      const a = read();
      if (!a || !a.salt || !a.hash) return false;
      const got = await hash(String(password || ''), fromHex(a.salt));
      return safeEqual(got, a.hash);
    },

    /** เปลี่ยนรหัส (ต้องรู้รหัสเดิม) */
    async changePassword(oldPassword, newPassword) {
      if (!(await this.verify(oldPassword))) throw new Error('รหัสผ่านเดิมไม่ถูกต้อง');
      const a = read();
      return this.signUp(a.username, newPassword);
    },

    /* ---------- สถานะการเข้าใช้งาน ----------
       จำไว้ = เก็บใน localStorage (ข้ามการปิดเบราว์เซอร์)
       ไม่จำ = เก็บใน sessionStorage (ปิดแท็บแล้วต้องกรอกใหม่)     */
    isSignedIn() {
      try {
        if (localStorage.getItem(SESSION_KEY) === 'remember') return true;
        return sessionStorage.getItem(SESSION_KEY) === 'active';
      } catch { return false; }
    },

    signIn(remember) {
      try {
        if (remember) localStorage.setItem(SESSION_KEY, 'remember');
        else sessionStorage.setItem(SESSION_KEY, 'active');
      } catch { /* ไม่ให้ล้มถ้าเขียนไม่ได้ */ }
    },

    signOut() {
      try {
        localStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_KEY);
      } catch { /* ignore */ }
    },

    /** ลบรหัสทิ้ง (ใช้ตอนผู้ใช้ลืมรหัส — ข้อมูลการนอนไม่ถูกลบ) */
    reset() {
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
      this.signOut();
    },
  };
});
