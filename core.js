/* =========================================================
   TimeSync — core.js
   ตรรกะการคำนวณล้วน ๆ (pure) ไม่แตะ DOM ไม่แตะ localStorage
   โหลดได้ทั้งใน browser (<script> → window.TimeSyncCore)
   และใน Node (require → module.exports) เพื่อให้เขียน unit test ได้
   ========================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TimeSyncCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------- ค่าคงที่ ---------- */
  const MIN_PER_DAY = 1440;
  const STATE_VERSION = 2;

  const TH_DAY = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  /* ---------- helpers ทั่วไป ---------- */
  const pad = n => String(n).padStart(2, '0');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /** "23:30" → 1410 นาทีจากเที่ยงคืน */
  function parseHM(s) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    if (!m) return 0;
    return clamp(Number(m[1]), 0, 23) * 60 + clamp(Number(m[2]), 0, 59);
  }

  /** 1410 → "23:30" (วนรอบ 24 ชม. เสมอ) */
  function minToHM(m) {
    m = ((Math.round(m) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  }

  /** Date → "YYYY-MM-DD" ตามเวลาท้องถิ่น (ไม่ใช้ toISOString เพราะจะเพี้ยนตาม timezone) */
  const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  /** "YYYY-MM-DD" → Date เที่ยงคืนตามเวลาท้องถิ่น */
  function keyToDate(k) {
    const [y, m, d] = String(k).split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  /** บวกวัน — ใช้ setDate เพื่อให้ข้ามเดือน/ปี/DST ได้ถูกต้อง */
  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  /** เที่ยงคืนของวัน `now` + นาทีที่กำหนด (setMinutes รองรับค่าเกิน 59 และ DST) */
  function todayAt(min, now) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setMinutes(min);
    return d;
  }

  /** จำนวนวันเต็ม (ตามปฏิทินท้องถิ่น) ระหว่างสองวัน — ไม่สนใจเวลาในวัน */
  function daysBetween(a, b) {
    const x = new Date(a); x.setHours(12, 0, 0, 0);
    const y = new Date(b); y.setHours(12, 0, 0, 0);
    return Math.round((y - x) / 86400000);
  }

  function durText(mins) {
    mins = Math.round(mins);
    const h = Math.floor(mins / 60), m = mins % 60;
    if (h && m) return `${h} ชม. ${m} นาที`;
    if (h) return `${h} ชม.`;
    return `${m} นาที`;
  }
  const hoursText = h => durText(Math.round(h * 60));

  /** ชั่วโมงที่นอน จากเวลาเข้านอน→ตื่น รองรับการนอนข้ามเที่ยงคืน */
  function hoursBetween(bed, wake) {
    let h = (parseHM(wake) - parseHM(bed)) / 60;
    if (h <= 0) h += 24;
    return Math.round(h * 100) / 100;
  }

  /* ---------- ชาร์ตเวลานอนสากล ----------
     National Sleep Foundation (Hirshkowitz et al., 2015) */
  const AGE_GROUPS = [
    { id: 'newborn',   label: 'ทารกแรกเกิด (0–3 เดือน)',   min: 14, max: 17 },
    { id: 'infant',    label: 'ทารก (4–11 เดือน)',          min: 12, max: 15 },
    { id: 'toddler',   label: 'เด็กเล็ก (1–2 ปี)',           min: 11, max: 14 },
    { id: 'preschool', label: 'วัยอนุบาล (3–5 ปี)',          min: 10, max: 13 },
    { id: 'school',    label: 'วัยเรียน (6–13 ปี)',          min: 9,  max: 11 },
    { id: 'teen',      label: 'วัยรุ่น (14–17 ปี)',           min: 8,  max: 10 },
    { id: 'young',     label: 'ผู้ใหญ่ตอนต้น (18–25 ปี)',    min: 7,  max: 9  },
    { id: 'adult',     label: 'ผู้ใหญ่ (26–64 ปี)',          min: 7,  max: 9  },
    { id: 'senior',    label: 'ผู้สูงวัย (65 ปีขึ้นไป)',       min: 7,  max: 8  },
  ];
  const ageGroupOf = id => AGE_GROUPS.find(g => g.id === id) || AGE_GROUPS[6];

  /* ---------- ระดับความล้า ---------- */
  const FATIGUE = [
    {
      lvl: 1, emoji: '😃', short: 'สดชื่น', label: 'สดชื่นเต็มที่',
      desc: 'ร่างกายยังมีพลังงานเหลือ ไม่มีสัญญาณของหนี้การนอน',
      cycles: 5, earlier: 0, maxWait: null, color: '#5ddba4',
      tips: [
        'เข้านอนตามเวลาเดิมทุกวัน คือสิ่งที่รักษาความสดชื่นนี้ไว้ได้ดีที่สุด',
        'เลี่ยงการงีบเกิน 30 นาทีหลังบ่าย 3 เพราะจะไปยืมเวลานอนของคืนนี้',
      ],
    },
    {
      lvl: 2, emoji: '🙂', short: 'พอไหว', label: 'เหนื่อยตามปกติ',
      desc: 'ความล้าระดับปกติของคนที่ใช้พลังงานมาทั้งวัน นอนคืนนี้ให้เต็มก็หายได้',
      cycles: 5, earlier: 0, maxWait: 240, color: '#8ea6ff',
      tips: [
        'หรี่ไฟและเลี่ยงจอ 30–60 นาทีก่อนเข้านอน เพื่อให้เมลาโทนินหลั่งตามธรรมชาติ',
        'อาบน้ำอุ่นก่อนนอน 1 ชม. ช่วยให้อุณหภูมิร่างกายลดลงและหลับเร็วขึ้น',
      ],
    },
    {
      lvl: 3, emoji: '😐', short: 'เริ่มล้า', label: 'เริ่มสะสมความล้า',
      desc: 'สมาธิเริ่มตก หาวบ่อยขึ้น เป็นสัญญาณว่ามีหนี้การนอนเล็กน้อยแล้ว',
      cycles: 5, earlier: 30, maxWait: 150, color: '#ffc46b',
      tips: [
        'เข้านอนเร็วขึ้นประมาณ 30 นาทีจากปกติ เพื่อทยอยคืนหนี้การนอน',
        'งดคาเฟอีนหลังบ่าย 2 โมง คาเฟอีนมีครึ่งชีวิตราว 5–6 ชั่วโมง',
        'ลองฟังเสียงผ่อนคลายในแท็บ "ผ่อนคลาย" ก่อนนอน 15 นาที',
      ],
    },
    {
      lvl: 4, emoji: '😪', short: 'ล้ามาก', label: 'ล้าสะสมชัดเจน',
      desc: 'ตอบสนองช้าลง อารมณ์แปรปรวนง่าย ร่างกายกำลังขอเวลานอนคืน',
      cycles: 6, earlier: 60, maxWait: 90, color: '#ff9d6b',
      tips: [
        'คืนนี้ควรนอนให้ครบ 6 รอบ (ราว 9 ชั่วโมง) เพื่อชดเชยส่วนที่ขาด',
        'ถ้ายังเป็นกลางวัน งีบสั้น 20 นาทีช่วยกู้ความตื่นตัวได้โดยไม่รบกวนการนอนกลางคืน',
        'เลี่ยงการขับรถหรืองานที่ต้องใช้ความแม่นยำสูงในช่วงนี้',
      ],
    },
    {
      lvl: 5, emoji: '😵', short: 'หมดแรง', label: 'อ่อนล้าขั้นวิกฤต',
      desc: 'ระดับความตื่นตัวใกล้เคียงกับคนอดนอนทั้งคืน ต้องเข้านอนโดยเร็วที่สุด',
      cycles: 6, earlier: 90, maxWait: 30, color: '#ff7d8a',
      tips: [
        'เข้านอนทันทีที่ทำได้ อย่าฝืนต่ออีกแม้แต่รอบเดียว',
        'ปิดจอทั้งหมดเดี๋ยวนี้ แล้วใช้การหายใจ 4-7-8 ในแท็บ "ผ่อนคลาย" ช่วยให้หลับเร็ว',
        'ถ้าอ่อนล้าระดับนี้ติดต่อกันหลายวัน ควรปรึกษาแพทย์เรื่องคุณภาพการนอน',
      ],
    },
  ];
  const fatigueOf = lvl => FATIGUE.find(f => f.lvl === lvl) || null;

  /* =========================================================
     คำนวณเวลาเข้านอนจากระดับความล้า
     cfg: { usualWake:'07:00', latency:15, cycleLen:90 }
     ========================================================= */
  function planBedtime(f, cfg, now) {
    now = now || new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const sleepNeed = f.cycles * cfg.cycleLen;                        // นาทีที่ต้องหลับจริง
    const usualBed = parseHM(cfg.usualWake) - sleepNeed - cfg.latency; // เวลาเข้านอนปกติ
    const targetMin = ((usualBed - f.earlier) % MIN_PER_DAY + MIN_PER_DAY) % MIN_PER_DAY;

    const isNight = nowMin >= 18 * 60 || nowMin < 5 * 60;
    const extraTips = [];
    let bedAt, bedLabel, bedNote, urgent = false;

    if (isNight) {
      // กลางคืน: หาเวลาเป้าหมายที่ใกล้ "ตอนนี้" ที่สุด (ภายใน ±12 ชม.)
      let cand = todayAt(targetMin, now);
      let diff = (cand - now) / 60000;
      if (diff > 720) { cand = addDays(cand, -1); diff -= MIN_PER_DAY; }
      else if (diff < -720) { cand = addDays(cand, 1); diff += MIN_PER_DAY; }

      if (diff <= 0) {
        bedAt = new Date(now);
        bedLabel = 'ตอนนี้เลย';
        bedNote = `เลยเวลาที่ควรเข้านอน (${minToHM(targetMin)}) มาแล้ว ${durText(-diff)}`;
        extraTips.push('ทุก ๆ 1 ชั่วโมงที่เลื่อนออกไป คือหนี้การนอนที่เพิ่มขึ้นอีก 1 ชั่วโมง');
        urgent = true;
      } else if (f.maxWait !== null && diff > f.maxWait) {
        bedAt = new Date(now.getTime() + f.maxWait * 60000);
        bedLabel = minToHM(bedAt.getHours() * 60 + bedAt.getMinutes());
        bedNote = `ความล้าระดับนี้ไม่ควรรอถึง ${minToHM(targetMin)} — เข้านอนภายใน ${durText(f.maxWait)}`;
        urgent = true;
      } else {
        bedAt = cand;
        bedLabel = minToHM(targetMin);
        bedNote = `อีก ${durText(diff)} จากนี้`;
        if (f.earlier > 0) extraTips.push(`เร็วกว่าเวลานอนปกติของคุณ ${durText(f.earlier)} เพื่อชดเชยความล้า`);
      }
    } else {
      // กลางวัน: แนะนำเวลานอนของคืนนี้
      let cand = todayAt(targetMin, now);
      if (targetMin < 5 * 60) cand = addDays(cand, 1);
      bedAt = cand;
      bedLabel = minToHM(targetMin);
      bedNote = `คืนนี้ — อีก ${durText((cand - now) / 60000)} จากนี้`;
      if (f.lvl >= 4) extraTips.push('ตอนนี้ยังเป็นกลางวัน: งีบ 20 นาที (ไม่เกินบ่าย 3) จะช่วยกู้ความตื่นตัวได้ทันที');
      if (f.earlier > 0) extraTips.push(`เร็วกว่าเวลานอนปกติของคุณ ${durText(f.earlier)} เพื่อชดเชยความล้า`);
    }

    const bedMin = bedAt.getHours() * 60 + bedAt.getMinutes();
    return {
      bedLabel, bedNote, extraTips, urgent, bedAt,
      bedMin,
      targetMin,
      wakeMin: bedMin + cfg.latency + sleepNeed,
      sleepNeed,
    };
  }

  /* =========================================================
     ตัวเลือกรอบการนอน
     mode: 'now' | 'bed' → คืนเวลาตื่น | 'wake' → คืนเวลาเข้านอน
     ========================================================= */
  const CYCLE_DESC = {
    3: 'สั้นเกินไปสำหรับการฟื้นฟู ใช้เฉพาะกรณีจำเป็นจริง ๆ',
    4: 'พอประคองได้ 1 คืน แต่จะสร้างหนี้การนอนเพิ่ม',
    5: 'เพียงพอสำหรับคนส่วนใหญ่ ตื่นมาสดชื่น',
    6: 'เต็มอิ่ม เหมาะกับวันที่ล้าหนักหรือต้องการชดเชยหนี้การนอน',
  };

  function cycleOptions(mode, timeMin, cfg) {
    const { cycleLen, latency } = cfg;
    const out = [];
    if (mode === 'wake') {
      for (let c = 6; c >= 3; c--) {
        out.push(makeOption(timeMin - latency - c * cycleLen, c, cycleLen));
      }
    } else {
      for (let c = 3; c <= 6; c++) {
        out.push(makeOption(timeMin + latency + c * cycleLen, c, cycleLen));
      }
    }
    return out;
  }

  function makeOption(min, cycles, cycleLen) {
    return {
      time: minToHM(min),
      minutes: ((Math.round(min) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY,
      cycles,
      totalMin: cycles * cycleLen,
      totalText: durText(cycles * cycleLen),
      desc: CYCLE_DESC[cycles],
      rank: (cycles === 5 || cycles === 6) ? 'best' : (cycles === 4 ? 'ok' : 'min'),
    };
  }

  /* =========================================================
     หนี้การนอนสะสม
     logs: { 'YYYY-MM-DD': {bed,wake,hours} }
     cfg:  { ageGroup, debtWindow }
     ========================================================= */
  const SURPLUS_CAP = 1;   // นอนเกินชดเชยได้สูงสุดวันละ 1 ชม.

  function computeDebt(logs, cfg, now) {
    now = now || new Date();
    const group = ageGroupOf(cfg.ageGroup);
    const target = group.min;                 // ใช้ค่าขั้นต่ำที่แนะนำเป็นเกณฑ์
    const days = [];
    let sum = 0, logged = 0, totalHours = 0;

    for (let i = cfg.debtWindow - 1; i >= 0; i--) {
      const d = addDays(now, -i);
      const key = dateKey(d);
      const rec = logs[key];
      if (rec && Number.isFinite(rec.hours)) {
        const diff = rec.hours - target;
        sum += diff < 0 ? diff : Math.min(diff, SURPLUS_CAP);
        logged++;
        totalHours += rec.hours;
      }
      days.push({ key, date: d, rec: rec || null });
    }

    const debt = Math.max(0, Math.round(-sum * 100) / 100);
    return {
      group, target, days, logged,
      missing: cfg.debtWindow - logged,
      avg: logged ? Math.round(totalHours / logged * 100) / 100 : 0,
      debt,
      level: !logged ? 'none' : debt < 1 ? 'ok' : debt < 5 ? 'low' : debt < 12 ? 'high' : 'severe',
    };
  }

  /* =========================================================
     state เริ่มต้น + การอัปเกรดโครงสร้างข้อมูล
     ========================================================= */
  function defaults() {
    return {
      version: STATE_VERSION,
      ageGroup: 'young',
      usualWake: '07:00',
      latency: 15,
      cycleLen: 90,
      debtWindow: 14,
      sleepLogs: {},
      fatigueLogs: {},
      tasks: [],
      remindTime: '07:00',
      remindOn: false,
      lastRemind: '',
      volume: 60,
    };
  }

  /**
   * อัปเกรด state เก่าให้เข้ากับเวอร์ชันปัจจุบัน โดยไม่ทำข้อมูลผู้ใช้หาย
   * เพิ่มขั้นตอนใหม่ต่อท้าย MIGRATIONS เมื่อโครงสร้างเปลี่ยนในอนาคต
   */
  const MIGRATIONS = [
    // v1 → v2 : เพิ่มเลขเวอร์ชันและกันค่าที่หายไปด้วยค่าเริ่มต้น
    function v1_to_v2(s) {
      s.version = 2;
      return s;
    },
  ];

  function migrate(raw) {
    const base = defaults();
    if (!raw || typeof raw !== 'object') return base;

    let s = Object.assign({}, base, raw);
    let v = Number(raw.version) || 1;
    while (v < STATE_VERSION) {
      const step = MIGRATIONS[v - 1];
      if (!step) break;
      s = step(s) || s;
      v = Number(s.version) || v + 1;
    }
    s.version = STATE_VERSION;

    // กันค่าที่เพี้ยน (ผู้ใช้แก้ไฟล์ import เอง / ข้อมูลเสียหาย)
    s.latency = clamp(Number(s.latency) || 0, 0, 45);
    s.cycleLen = clamp(Number(s.cycleLen) || 90, 80, 110);
    s.debtWindow = clamp(Math.round(Number(s.debtWindow) || 14), 7, 30);
    s.volume = clamp(Math.round(Number(s.volume)) || 0, 0, 100);
    if (!ageGroupOf(s.ageGroup) || !AGE_GROUPS.some(g => g.id === s.ageGroup)) s.ageGroup = base.ageGroup;
    if (!Array.isArray(s.tasks)) s.tasks = [];
    if (!s.sleepLogs || typeof s.sleepLogs !== 'object') s.sleepLogs = {};
    if (!s.fatigueLogs || typeof s.fatigueLogs !== 'object') s.fatigueLogs = {};
    return s;
  }

  /* ---------- export ---------- */
  return {
    MIN_PER_DAY, STATE_VERSION, SURPLUS_CAP, TH_DAY, TH_MON,
    AGE_GROUPS, FATIGUE, CYCLE_DESC,
    pad, clamp, parseHM, minToHM, dateKey, keyToDate, addDays, todayAt, daysBetween,
    durText, hoursText, hoursBetween,
    ageGroupOf, fatigueOf,
    planBedtime, cycleOptions, computeDebt,
    defaults, migrate,
  };
});
