/* =========================================================
   TimeSync — alarm.js
   เครื่องยนต์นาฬิกาปลุก: เสียงปลุกสังเคราะห์, ไฟล์เสียงของผู้ใช้ (IndexedDB),
   การไต่ระดับเสียง, และการตั้งเวลาที่ทนต่อการถูก throttle ของแท็บเบื้องหลัง

   หมายเหตุเชิงเทคนิค
   - setTimeout ในแท็บเบื้องหลังถูกเบราว์เซอร์หน่วงเหลือ ~1 ครั้ง/นาที
     แต่นาฬิกาของ AudioContext ไม่ถูกหน่วง จึงตั้งเสียงล่วงหน้าไว้บน
     audio clock เมื่อใกล้ถึงเวลา เพื่อให้ปลุกตรงเวลาแม้ไม่ได้เปิดหน้าไว้
   - เบราว์เซอร์ห้ามเล่นเสียงก่อนมี user gesture (autoplay policy)
     จึงต้อง unlock AudioContext ที่การคลิกครั้งแรกของผู้ใช้
   ========================================================= */
(function (global) {
  'use strict';
  const C = global.TimeSyncCore;

  /* =========================================================
     คลังไฟล์เสียงของผู้ใช้ (IndexedDB)
     ========================================================= */
  const SoundStore = {
    DB: 'timesync', STORE: 'sounds', VERSION: 1,
    _db: null,

    async open() {
      if (this._db) return this._db;
      if (!global.indexedDB) throw new Error('เบราว์เซอร์นี้ไม่รองรับ IndexedDB');
      this._db = await new Promise((res, rej) => {
        const req = indexedDB.open(this.DB, this.VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.STORE)) {
            db.createObjectStore(this.STORE, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      return this._db;
    },

    async _tx(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const tx = db.transaction(this.STORE, mode);
        const store = tx.objectStore(this.STORE);
        const req = fn(store);
        tx.onerror = () => rej(tx.error);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
    },

    add(rec) { return this._tx('readwrite', s => s.put(rec)); },
    get(id) { return this._tx('readonly', s => s.get(id)); },
    all() { return this._tx('readonly', s => s.getAll()); },
    remove(id) { return this._tx('readwrite', s => s.delete(id)); },
  };

  /* =========================================================
     เครื่องยนต์เสียงปลุก
     ========================================================= */
  const MAX_UPLOAD = 50 * 1024 * 1024;   // 50 MB
  const WARN_UPLOAD = 20 * 1024 * 1024;

  const Alarm = {
    ctx: null,
    master: null,          // gain รวม — ใช้ควบคุมการไต่ระดับเสียง
    keepAlive: null,       // oscillator เงียบ ๆ กัน AudioContext ถูก suspend
    nodes: [],             // ตัวหยุดเสียงของรอบที่กำลังเล่น
    patternId: null,
    ringing: false,
    startedAt: 0,
    rampTimer: null,
    audioEl: null,         // <audio> สำหรับไฟล์ที่ผู้ใช้อัปโหลด
    objectUrl: null,
    unlocked: false,
    onStateChange: null,   // callback ให้ UI อัปเดต

    /* ---------- autoplay policy ---------- */

    /** สร้าง/ปลุก AudioContext — ต้องถูกเรียกจากภายใน user gesture ครั้งแรก */
    unlock() {
      try {
        if (!this.ctx) {
          const AC = global.AudioContext || global.webkitAudioContext;
          this.ctx = new AC();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();

        // เล่น buffer เงียบ 1 ครั้ง — บาง browser ต้องมีการเล่นจริงถึงจะปลดล็อก
        const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
        const src = this.ctx.createBufferSource();
        src.buffer = b;
        src.connect(this.ctx.destination);
        src.start(0);

        this.unlocked = this.ctx.state === 'running';
      } catch { this.unlocked = false; }
      return this.unlocked;
    },

    /** เบราว์เซอร์พร้อมเล่นเสียงตอนนี้ไหม */
    get ready() {
      return !!(this.ctx && this.ctx.state === 'running');
    },

    /**
     * เปิดเสียงเงียบค้างไว้ขณะตั้งปลุก เพื่อไม่ให้ AudioContext ถูก suspend
     * ตอนแท็บอยู่เบื้องหลัง (ทำให้ตั้งเสียงล่วงหน้าบน audio clock ได้)
     */
    startKeepAlive() {
      if (!this.ctx || this.keepAlive) return;
      try {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        g.gain.value = 0.0001;              // เบาจนไม่ได้ยิน แต่ context ยังทำงาน
        osc.frequency.value = 30;
        osc.connect(g).connect(this.ctx.destination);
        osc.start();
        this.keepAlive = { osc, g };
      } catch { /* ไม่เป็นไร ถ้าทำไม่ได้ก็ยังใช้ setTimeout ได้ */ }
    },

    stopKeepAlive() {
      if (!this.keepAlive) return;
      try { this.keepAlive.osc.stop(); this.keepAlive.osc.disconnect(); } catch {}
      this.keepAlive = null;
    },

    /* ---------- การเล่นเสียง ---------- */

    /**
     * เริ่มปลุก
     * @param {object} cfg  ค่าจาก state.alarm (sound, customId, volume, rampSec)
     * @param {boolean} preview  โหมดทดสอบเสียง (เล่นสั้น ๆ ไม่ ramp)
     */
    async start(cfg, preview) {
      this.stop();
      if (!this.ctx) this.unlock();
      if (!this.ctx) return false;
      if (this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch {} }

      this.ringing = true;
      this.startedAt = Date.now();

      const vol = (cfg.volume === undefined ? 100 : cfg.volume) / 100;
      this.master = this.ctx.createGain();
      const ramp = preview ? 0 : (cfg.rampSec || 0);
      this.master.gain.value = vol * C.alarmRampGain(0, ramp);
      this.master.connect(this.ctx.destination);

      // ไต่ระดับเสียงทีละขั้น (คำนวณจาก core เพื่อให้เทสต์ได้)
      if (ramp > 0) {
        this.rampTimer = setInterval(() => {
          if (!this.ringing) return;
          const elapsed = (Date.now() - this.startedAt) / 1000;
          const g = vol * C.alarmRampGain(elapsed, ramp);
          try { this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.3); } catch {}
          if (elapsed >= ramp) { clearInterval(this.rampTimer); this.rampTimer = null; }
        }, 500);
      }

      if (cfg.sound === 'custom' && cfg.customId) {
        const ok = await this.playCustom(cfg.customId, preview);
        if (!ok) this.playPattern('classic', preview);       // ไฟล์หาย → ถอยไปเสียงมาตรฐาน
      } else {
        this.playPattern(cfg.sound, preview);
      }

      if (preview) setTimeout(() => this.stop(), 4000);
      if (this.onStateChange) this.onStateChange();
      return true;
    },

    stop() {
      this.ringing = false;
      clearInterval(this.rampTimer); this.rampTimer = null;
      clearInterval(this.patternId); this.patternId = null;

      this.nodes.forEach(f => { try { f(); } catch {} });
      this.nodes = [];

      if (this.audioEl) {
        try { this.audioEl.pause(); this.audioEl.currentTime = 0; } catch {}
        this.audioEl = null;
      }
      if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
      if (this.master) { try { this.master.disconnect(); } catch {} this.master = null; }
      if (this.onStateChange) this.onStateChange();
    },

    /** ไฟล์เสียงของผู้ใช้ — ใช้ <audio> + MediaElementSource เพื่อไม่ต้องโหลดทั้งไฟล์เข้าหน่วยความจำ */
    async playCustom(id, preview) {
      try {
        const rec = await SoundStore.get(id);
        if (!rec || !rec.blob) return false;

        this.objectUrl = URL.createObjectURL(rec.blob);
        const el = new Audio(this.objectUrl);
        el.loop = !preview;
        el.crossOrigin = 'anonymous';
        this.audioEl = el;

        const src = this.ctx.createMediaElementSource(el);
        src.connect(this.master);
        await el.play();
        this.nodes.push(() => { try { src.disconnect(); } catch {} });
        return true;
      } catch {
        return false;
      }
    },

    /** เสียงปลุกสังเคราะห์ — เล่นเป็นจังหวะซ้ำจนกว่าจะถูกสั่งหยุด */
    playPattern(kind, preview) {
      const build = {
        classic: () => this.patternClassic(),
        siren:   () => this.patternSiren(),
        bells:   () => this.patternBells(),
        digital: () => this.patternDigital(),
        rise:    () => this.patternRise(),
      }[kind] || (() => this.patternClassic());

      build();
      if (!preview) {
        const every = { classic: 1800, siren: 2600, bells: 2200, digital: 1500, rise: 4000 }[kind] || 1800;
        this.patternId = setInterval(build, every);
      }
    },

    /** บี๊บสองครั้งแบบนาฬิกาปลุกมาตรฐาน */
    patternClassic() {
      const t0 = this.ctx.currentTime;
      [0, 0.28].forEach(off => this.beep(t0 + off, 880, 0.22, 'square'));
      [0.62, 0.9].forEach(off => this.beep(t0 + off, 880, 0.22, 'square'));
    },

    /** ไซเรนกวาดขึ้น-ลง */
    patternSiren() {
      const ctx = this.ctx, t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(420, t0);
      for (let i = 0; i < 3; i++) {
        osc.frequency.linearRampToValueAtTime(1150, t0 + i * 0.7 + 0.35);
        osc.frequency.linearRampToValueAtTime(420, t0 + i * 0.7 + 0.7);
      }
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.32, t0 + 0.05);
      g.gain.setValueAtTime(0.32, t0 + 2.0);
      g.gain.linearRampToValueAtTime(0, t0 + 2.15);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
      osc.connect(lp).connect(g).connect(this.master);
      osc.start(t0); osc.stop(t0 + 2.2);
      this.nodes.push(() => { try { osc.stop(); } catch {} });
    },

    /** ระฆังโลหะที่ตีถี่ขึ้นเรื่อย ๆ */
    patternBells() {
      const t0 = this.ctx.currentTime;
      let off = 0, gap = 0.42;
      for (let i = 0; i < 6; i++) {
        this.bell(t0 + off, 660 + (i % 2) * 220);
        off += gap;
        gap *= 0.86;                       // ยิ่งตียิ่งถี่ = ยิ่งเร่งให้ตื่น
      }
    },

    /** บี๊บสั้นถี่แบบนาฬิกาข้อมือดิจิทัล */
    patternDigital() {
      const t0 = this.ctx.currentTime;
      for (let i = 0; i < 4; i++) this.beep(t0 + i * 0.13, 2100, 0.07, 'square');
      for (let i = 0; i < 4; i++) this.beep(t0 + 0.75 + i * 0.13, 2100, 0.07, 'square');
    },

    /** คอร์ดไต่ระดับ — นุ่มกว่าตัวอื่นแต่ยังดังพอจะปลุก */
    patternRise() {
      const ctx = this.ctx, t0 = ctx.currentTime;
      [392, 523.25, 659.25, 783.99].forEach((f, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = f;
        const s = t0 + i * 0.45;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.16, s + 0.25);
        g.gain.exponentialRampToValueAtTime(0.001, s + 2.4);
        osc.connect(g).connect(this.master);
        osc.start(s); osc.stop(s + 2.5);
        this.nodes.push(() => { try { osc.stop(); } catch {} });
      });
    },

    beep(when, freq, dur, type) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type || 'square';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(0.3, when + 0.008);
      g.gain.setValueAtTime(0.3, when + dur - 0.02);
      g.gain.linearRampToValueAtTime(0, when + dur);
      osc.connect(g).connect(this.master);
      osc.start(when); osc.stop(when + dur + 0.02);
      this.nodes.push(() => { try { osc.stop(); } catch {} });
    },

    bell(when, freq) {
      const ctx = this.ctx;
      const carrier = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const modGain = ctx.createGain();
      const g = ctx.createGain();
      carrier.frequency.value = freq;
      mod.frequency.value = freq * 1.41;        // อัตราส่วนอโหฺรมาติก = เสียงโลหะ
      modGain.gain.value = freq * 1.2;
      mod.connect(modGain).connect(carrier.frequency);
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(0.28, when + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, when + 1.1);
      carrier.connect(g).connect(this.master);
      carrier.start(when); mod.start(when);
      carrier.stop(when + 1.2); mod.stop(when + 1.2);
      this.nodes.push(() => { try { carrier.stop(); mod.stop(); } catch {} });
    },
  };

  /* =========================================================
     การอัปโหลดไฟล์เสียง
     ========================================================= */
  const Uploads = {
    MAX: MAX_UPLOAD,
    WARN: WARN_UPLOAD,

    /** ตรวจไฟล์ก่อนบันทึก — คืนข้อความ error หรือ null ถ้าผ่าน */
    validate(file) {
      if (!file) return 'ไม่พบไฟล์';
      if (!/^audio\//.test(file.type) && !/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name)) {
        return 'รองรับเฉพาะไฟล์เสียง (mp3, wav, ogg, m4a)';
      }
      if (file.size > this.MAX) {
        return `ไฟล์ใหญ่เกินไป (${(file.size / 1048576).toFixed(1)} MB) จำกัดที่ ${this.MAX / 1048576} MB`;
      }
      return null;
    },

    async save(file) {
      const rec = {
        id: 'snd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 60),
        type: file.type || 'audio/mpeg',
        size: file.size,
        blob: file,
        addedAt: Date.now(),
      };
      await SoundStore.add(rec);
      return rec;
    },

    list() { return SoundStore.all(); },
    remove(id) { return SoundStore.remove(id); },
  };

  global.TimeSyncAlarm = { Alarm, SoundStore, Uploads };
})(typeof globalThis !== 'undefined' ? globalThis : this);
