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
  const STATE_VERSION = 4;

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
     เวลาเข้านอนประจำ + การเตือน
     ========================================================= */

  /** เวลาเข้านอนปกติ (นาทีจากเที่ยงคืน) — อิงเวลาตื่นประจำ ถอยหลัง 5 รอบ + เวลาที่ใช้กว่าจะหลับ */
  function usualBedtimeMin(cfg) {
    const base = parseHM(cfg.usualWake) - DEFAULT_CYCLES * cfg.cycleLen - cfg.latency;
    return ((base % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  }
  const DEFAULT_CYCLES = 5;

  /**
   * หา Date ของ "ครั้งถัดไป" ที่นาฬิกาจะชี้ไปที่ targetMin
   * ถ้าเวลานั้นของวันนี้ผ่านไปแล้ว จะได้ของวันพรุ่งนี้
   */
  function nextOccurrence(targetMin, now) {
    const cand = todayAt(targetMin, now);
    return cand > now ? cand : addDays(cand, 1);
  }

  /**
   * หา Date ของครั้งล่าสุดที่ผ่านมา (หรือตอนนี้พอดี)
   */
  function lastOccurrence(targetMin, now) {
    const cand = todayAt(targetMin, now);
    return cand <= now ? cand : addDays(cand, -1);
  }

  /**
   * ควรถามผู้ใช้ให้ยืนยันการนอนเมื่อคืนไหม (ฟีเจอร์ "กดยืนยันครั้งเดียว")
   * เงื่อนไข: เป็นช่วงกลางวัน + ยังไม่ได้บันทึกของวันนี้ + เคยบันทึกมาก่อน + ยังไม่ได้ปิดการ์ดวันนี้
   */
  function shouldAskToLog(state, now) {
    now = now || new Date();
    const key = dateKey(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const inAskWindow = nowMin >= 5 * 60 && nowMin < 20 * 60;

    if (!inAskWindow) return { ask: false, reason: 'นอกช่วงเวลาถาม' };
    if (state.sleepLogs[key]) return { ask: false, reason: 'บันทึกวันนี้แล้ว' };
    if (state.askDismissed === key) return { ask: false, reason: 'ผู้ใช้ปิดการ์ดไปแล้ว' };
    if (!state.lastBed || !state.lastWake) return { ask: false, reason: 'ยังไม่เคยบันทึก' };

    return {
      ask: true,
      date: key,
      bed: state.lastBed,
      wake: state.lastWake,
      hours: hoursBetween(state.lastBed, state.lastWake),
    };
  }

  /* ---------- ตัวเตือนรายวัน ----------
     grace = ยอมให้ "ตามเก็บ" ได้กี่นาทีหลังเลยเวลา (เผื่อผู้ใช้ปิดแอปอยู่)
     แต่ละตัวยิงได้วันละครั้ง โดยจำไว้ใน state.fired ด้วยคีย์ `id:YYYY-MM-DD` */
  const REMINDER_GRACE = { log: 360, bedtime: 45, alarmMissing: 60, morning: 360 };

  /**
   * คืนรายการเตือนที่ถึงกำหนดและยังไม่เคยยิง
   * ไม่แตะ state — ผู้เรียกเป็นคนบันทึกว่ายิงแล้ว (markFired)
   */
  function dueReminders(state, now) {
    now = now || new Date();
    const out = [];
    const fired = state.fired || {};
    const push = (id, dueDate, payload) => {
      const late = (now - dueDate) / 60000;
      if (late < 0 || late > REMINDER_GRACE[id]) return;
      const key = `${id}:${dateKey(dueDate)}`;
      if (fired[key]) return;
      out.push(Object.assign({ id, key, dueAt: dueDate, lateMin: Math.round(late) }, payload));
    };

    const R = state.reminders || {};

    // 1) เตือนให้เข้ามาบันทึกการนอนเมื่อคืน
    if (R.log && R.log.on && !state.sleepLogs[dateKey(now)]) {
      push('log', lastOccurrence(parseHM(R.log.time), now), {
        title: 'TimeSync — บันทึกการนอนเมื่อคืน',
        body: state.lastBed
          ? `เมื่อคืนนอน ${state.lastBed}–${state.lastWake} เหมือนเดิมไหม? กดยืนยันครั้งเดียวจบ`
          : 'ใช้เวลาไม่ถึง 10 วินาที เพื่อให้หนี้การนอนของคุณแม่นยำ',
        tab: 'debt',
      });
    }

    // 2) เตือนก่อนถึงเวลาเข้านอน
    const bedMin = usualBedtimeMin(state);
    if (R.bedtime && R.bedtime.on) {
      const lead = R.bedtime.leadMin || 0;
      push('bedtime', lastOccurrence(bedMin - lead, now), {
        title: 'TimeSync — ใกล้ถึงเวลานอนแล้ว',
        body: lead > 0
          ? `อีก ${durText(lead)} ถึงเวลาเข้านอน (${minToHM(bedMin)}) เริ่มหรี่ไฟและวางจอได้แล้ว`
          : `ถึงเวลาเข้านอน (${minToHM(bedMin)}) แล้ว`,
        tab: 'relax',
      });
    }

    // 3) ถึงเวลานอนแล้วแต่ยังไม่ได้ตั้งปลุก
    if (R.alarmMissing && R.alarmMissing.on && !(state.alarm && state.alarm.on)) {
      push('alarmMissing', lastOccurrence(bedMin, now), {
        title: 'TimeSync — ยังไม่ได้ตั้งปลุก',
        body: 'ถึงเวลานอนแล้วแต่ยังไม่มีนาฬิกาปลุกสำหรับพรุ่งนี้ กดเพื่อตั้งเลย',
        tab: 'calc',
      });
    }

    // 4) เตือนงานสำคัญตอนเช้า (ของเดิม)
    if (state.remindOn) {
      const pending = (state.tasks || []).filter(t => !t.done);
      push('morning', lastOccurrence(parseHM(state.remindTime), now), {
        title: 'TimeSync — อรุณสวัสดิ์ ☀️',
        body: pending.length
          ? pending.slice(0, 3).map(t => '• ' + t.text).join('\n') +
            (pending.length > 3 ? `\n…และอีก ${pending.length - 3} รายการ` : '')
          : 'วันนี้ยังไม่มีรายการที่ต้องทำ ขอให้เป็นวันที่ดีนะ',
        tab: 'tasks',
        pending,
      });
    }

    return out;
  }

  /** บันทึกว่าเตือนไปแล้ว + ตัดประวัติเก่าทิ้งไม่ให้ state บวม */
  function markFired(state, key, keep) {
    const fired = state.fired || (state.fired = {});
    fired[key] = Date.now();
    const max = keep || 60;
    const keys = Object.keys(fired);
    if (keys.length > max) {
      keys.sort((a, b) => fired[a] - fired[b])
          .slice(0, keys.length - max)
          .forEach(k => delete fired[k]);
    }
    return state;
  }

  /* =========================================================
     นาฬิกาปลุก (Phase 2)
     ========================================================= */

  /** เสียงปลุกสังเคราะห์ — ทุกตัวออกแบบให้ "ปลุกให้ตื่น" ไม่ใช่กล่อมให้หลับต่อ */
  const ALARM_SOUNDS = [
    { id: 'classic', icon: '🔔', name: 'บี๊บคลาสสิก', desc: 'เสียงนาฬิกาปลุกมาตรฐาน ตื่นแน่' },
    { id: 'siren',   icon: '🚨', name: 'ไซเรนไต่',    desc: 'เสียงกวาดขึ้น-ลง เร่งเร้าที่สุด' },
    { id: 'bells',   icon: '⛑️', name: 'ระฆังเร่ง',    desc: 'ระฆังโลหะ ถี่ขึ้นเรื่อย ๆ' },
    { id: 'digital', icon: '📟', name: 'ดิจิทัล',      desc: 'บี๊บสั้นถี่แบบนาฬิกาข้อมือ' },
    { id: 'rise',    icon: '🌅', name: 'ค่อย ๆ ปลุก',  desc: 'คอร์ดไต่ระดับ นุ่มแต่ดังขึ้นจนตื่น' },
  ];
  const alarmSoundOf = id => ALARM_SOUNDS.find(s => s.id === id) || ALARM_SOUNDS[0];

  const ALARM_GRACE = 30;        // ถ้าเปิดแอปช้ากว่านี้ (นาที) ถือว่าพลาดไปแล้ว ไม่ปลุกย้อนหลัง
  const RAMP_OPTIONS = [0, 10, 30, 60];
  const SNOOZE_OPTIONS = [5, 9, 10, 15];

  /**
   * สถานะปัจจุบันของนาฬิกาปลุก
   * คืน due=true เมื่อถึงเวลาต้องดังแล้วและยังไม่ได้ปลุกไปในรอบนั้น
   */
  function alarmStatus(alarm, now) {
    now = now || new Date();
    if (!alarm || !alarm.on) return { armed: false, due: false, nextAt: null, snoozed: false };

    // กำลังอยู่ในช่วงเลื่อนปลุก — ใช้เวลาเลื่อนแทนเวลาปกติ
    if (alarm.snoozedUntil) {
      const t = new Date(alarm.snoozedUntil);
      return {
        armed: true, snoozed: true, nextAt: t,
        due: now >= t,
        leftMin: Math.max(0, (t - now) / 60000),
      };
    }

    const targetMin = parseHM(alarm.time);
    const last = lastOccurrence(targetMin, now);
    const lateMin = (now - last) / 60000;
    const rungKey = dateKey(last);
    const alreadyRung = alarm.lastRung === rungKey;
    const due = !alreadyRung && lateMin >= 0 && lateMin <= ALARM_GRACE;

    return {
      armed: true, snoozed: false, due, lateMin, rungKey, alreadyRung,
      nextAt: due ? last : nextOccurrence(targetMin, now),
      leftMin: due ? 0 : (nextOccurrence(targetMin, now) - now) / 60000,
    };
  }

  /**
   * ระดับเสียงขณะไต่ขึ้น (volume ramp-up) — 0..1
   * rampSec = 0 หมายถึงดังเต็มทันที
   */
  function alarmRampGain(elapsedSec, rampSec, startGain) {
    if (!rampSec || rampSec <= 0) return 1;
    const start = startGain === undefined ? 0.08 : startGain;
    const t = clamp(elapsedSec / rampSec, 0, 1);
    // ไต่แบบ ease-in — ช่วงแรกค่อยเป็นค่อยไป ท้าย ๆ ดังเร็วขึ้น เพื่อไม่ให้หลับต่อ
    return clamp(start + (1 - start) * (t * t), 0, 1);
  }

  /** เวลาที่จะปลุกอีกครั้งหลังกดเลื่อน */
  function snoozeUntil(now, snoozeMin) {
    return new Date((now || new Date()).getTime() + (snoozeMin || 9) * 60000);
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

      // --- Phase 1: แก้ปัญหา "ลืม" ---
      lastBed: '',            // เวลาเข้านอนที่บันทึกล่าสุด → ใช้เป็นค่า default
      lastWake: '',
      askDismissed: '',       // dateKey ของวันที่ผู้ใช้ปิดการ์ดยืนยัน
      fired: {},              // กันการเตือนซ้ำ: { 'log:2026-08-02': timestamp }

      // --- Phase 2: นาฬิกาปลุก ---
      alarm: {
        on: false,
        time: '07:00',
        sound: 'classic',     // id จาก ALARM_SOUNDS หรือ 'custom'
        customId: null,       // id ของไฟล์เสียงใน IndexedDB เมื่อ sound === 'custom'
        volume: 100,          // ดังเต็มโดยค่าเริ่มต้น (ผลสำรวจ: เสียงเดิมเบาเกินไป)
        rampSec: 30,          // ค่อย ๆ ดังขึ้นใน 30 วินาที
        snoozeMin: 9,
        maxSnooze: 3,
        vibrate: true,
        snoozedUntil: null,
        snoozeCount: 0,
        lastRung: '',
      },
      reminders: {
        log:          { on: true, time: '10:00' },
        bedtime:      { on: true, leadMin: 30 },
        alarmMissing: { on: true },
      },
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

    // v2 → v3 : เพิ่มระบบเตือน/ปลุก และเดาค่า default จากบันทึกล่าสุดที่มีอยู่
    function v2_to_v3(s) {
      const d = defaults();
      s.alarm = Object.assign({}, d.alarm, s.alarm);
      s.reminders = Object.assign({}, d.reminders, s.reminders);
      s.fired = s.fired || {};
      s.askDismissed = s.askDismissed || '';

      // ผู้ใช้เดิมที่เคยบันทึกไว้แล้ว ให้หยิบคืนล่าสุดมาเป็นค่า default ทันที
      if (!s.lastBed || !s.lastWake) {
        const keys = Object.keys(s.sleepLogs || {}).sort();
        const last = keys.length ? s.sleepLogs[keys[keys.length - 1]] : null;
        s.lastBed = (last && last.bed) || '';
        s.lastWake = (last && last.wake) || '';
      }
      // เวลาปลุกเริ่มต้น = เวลาตื่นประจำที่ตั้งไว้อยู่แล้ว
      if (s.alarm.time === d.alarm.time && s.usualWake) s.alarm.time = s.usualWake;

      s.version = 3;
      return s;
    },

    // v3 → v4 : ขยายนาฬิกาปลุกให้มีเสียง/ความดัง/ramp-up/เลื่อนปลุก
    function v3_to_v4(s) {
      s.alarm = Object.assign({}, defaults().alarm, s.alarm);
      s.version = 4;
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
    if (!s.fired || typeof s.fired !== 'object') s.fired = {};
    if (!s.alarm || typeof s.alarm !== 'object') s.alarm = base.alarm;
    else s.alarm = Object.assign({}, base.alarm, s.alarm);
    s.alarm.volume = clamp(Math.round(Number(s.alarm.volume)) || 0, 0, 100);
    s.alarm.rampSec = RAMP_OPTIONS.includes(Number(s.alarm.rampSec)) ? Number(s.alarm.rampSec) : base.alarm.rampSec;
    s.alarm.snoozeMin = clamp(Math.round(Number(s.alarm.snoozeMin)) || base.alarm.snoozeMin, 1, 60);
    if (s.alarm.sound !== 'custom' && !ALARM_SOUNDS.some(x => x.id === s.alarm.sound)) {
      s.alarm.sound = base.alarm.sound;
    }
    // เสียงที่ผู้ใช้อัปโหลดหายไป (ล้าง IndexedDB) → ถอยกลับไปใช้เสียงมาตรฐาน
    if (s.alarm.sound === 'custom' && !s.alarm.customId) s.alarm.sound = base.alarm.sound;
    if (!s.reminders || typeof s.reminders !== 'object') s.reminders = base.reminders;
    for (const k of Object.keys(base.reminders)) {
      s.reminders[k] = Object.assign({}, base.reminders[k], s.reminders[k]);
    }
    return s;
  }

  /* ---------- export ---------- */
  return {
    MIN_PER_DAY, STATE_VERSION, SURPLUS_CAP, DEFAULT_CYCLES, REMINDER_GRACE, TH_DAY, TH_MON,
    AGE_GROUPS, FATIGUE, CYCLE_DESC,
    ALARM_SOUNDS, ALARM_GRACE, RAMP_OPTIONS, SNOOZE_OPTIONS,
    alarmSoundOf, alarmStatus, alarmRampGain, snoozeUntil,
    pad, clamp, parseHM, minToHM, dateKey, keyToDate, addDays, todayAt, daysBetween,
    durText, hoursText, hoursBetween,
    ageGroupOf, fatigueOf,
    planBedtime, cycleOptions, computeDebt,
    usualBedtimeMin, nextOccurrence, lastOccurrence,
    shouldAskToLog, dueReminders, markFired,
    defaults, migrate,
  };
});
