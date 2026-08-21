/* =========================================================
   TimeSync — unit tests สำหรับ core.js
   รันด้วย:  node --test tests/
   ใช้ test runner ที่ติดมากับ Node เอง ไม่ต้องลง dependency
   ========================================================= */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

/** สร้าง Date เวลาท้องถิ่นแบบอ่านง่าย: at(2026, 8, 2, 23, 30) = 2 ส.ค. 2026 23:30 */
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);

/* ---------------------------------------------------------
   helpers เรื่องเวลา
   --------------------------------------------------------- */
describe('parseHM / minToHM', () => {
  test('แปลงไป-กลับได้ตรงกัน', () => {
    for (const s of ['00:00', '07:00', '12:34', '23:59']) {
      assert.equal(C.minToHM(C.parseHM(s)), s);
    }
  });

  test('รับค่าผิดรูปแบบโดยไม่พัง', () => {
    assert.equal(C.parseHM(''), 0);
    assert.equal(C.parseHM(null), 0);
    assert.equal(C.parseHM('ไม่ใช่เวลา'), 0);
    assert.equal(C.parseHM('7:05'), 425);
  });

  test('minToHM วนรอบ 24 ชม. ทั้งค่าบวกและค่าลบ', () => {
    assert.equal(C.minToHM(1440), '00:00');
    assert.equal(C.minToHM(1500), '01:00');
    assert.equal(C.minToHM(-30), '23:30');        // ย้อนหลังข้ามเที่ยงคืน
    assert.equal(C.minToHM(-1470), '23:30');      // ย้อนหลังเกินหนึ่งวัน
  });
});

describe('dateKey / keyToDate', () => {
  test('ใช้เวลาท้องถิ่น ไม่ใช่ UTC', () => {
    // 23:30 ของวันที่ 2 — ถ้าเผลอใช้ toISOString ใน timezone ตะวันออก จะกลายเป็นวันที่ 3
    assert.equal(C.dateKey(at(2026, 8, 2, 23, 30)), '2026-08-02');
    // 00:30 ของวันที่ 2 — ถ้าใช้ UTC ใน timezone ตะวันตก จะกลายเป็นวันที่ 1
    assert.equal(C.dateKey(at(2026, 8, 2, 0, 30)), '2026-08-02');
  });

  test('เติมศูนย์นำหน้าเดือน/วัน', () => {
    assert.equal(C.dateKey(at(2026, 1, 5)), '2026-01-05');
  });

  test('แปลงไป-กลับได้ตรงกัน', () => {
    const k = '2026-02-29';   // 2026 ไม่ใช่ปีอธิกสุรทิน → JS จะเลื่อนเป็น 1 มี.ค.
    assert.equal(C.dateKey(C.keyToDate('2026-08-02')), '2026-08-02');
    assert.equal(C.dateKey(C.keyToDate(k)), '2026-03-01');
  });
});

describe('addDays', () => {
  test('ข้ามสิ้นเดือน', () => {
    assert.equal(C.dateKey(C.addDays(at(2026, 1, 31), 1)), '2026-02-01');
    assert.equal(C.dateKey(C.addDays(at(2026, 3, 1), -1)), '2026-02-28');
  });

  test('ข้ามสิ้นปี', () => {
    assert.equal(C.dateKey(C.addDays(at(2026, 12, 31), 1)), '2027-01-01');
    assert.equal(C.dateKey(C.addDays(at(2027, 1, 1), -1)), '2026-12-31');
  });

  test('ปีอธิกสุรทิน', () => {
    assert.equal(C.dateKey(C.addDays(at(2028, 2, 28), 1)), '2028-02-29');
  });

  test('ไม่ทำให้เวลาในวันเพี้ยนแม้ข้ามช่วงเปลี่ยนเวลา (DST)', () => {
    // 8 มี.ค. 2026 คือวันเริ่ม DST ของสหรัฐฯ — ถ้าใช้ +86400000ms จะได้ชั่วโมงเพี้ยน
    const d = C.addDays(at(2026, 3, 7, 12, 0), 1);
    assert.equal(d.getHours(), 12);
    assert.equal(C.dateKey(d), '2026-03-08');
  });

  test('ไม่แก้ค่า Date ต้นฉบับ', () => {
    const orig = at(2026, 8, 2);
    C.addDays(orig, 10);
    assert.equal(C.dateKey(orig), '2026-08-02');
  });
});

describe('todayAt', () => {
  test('คืนเวลาในวันเดียวกับ now', () => {
    const d = C.todayAt(1350, at(2026, 8, 2, 3, 15));   // 22:30
    assert.equal(C.dateKey(d), '2026-08-02');
    assert.equal(d.getHours(), 22);
    assert.equal(d.getMinutes(), 30);
  });

  test('ค่านาทีเกิน 1 วันจะไหลไปวันถัดไป', () => {
    const d = C.todayAt(1500, at(2026, 8, 2, 3, 0));    // 25:00
    assert.equal(C.dateKey(d), '2026-08-03');
    assert.equal(d.getHours(), 1);
  });
});

describe('durText', () => {
  test('รูปแบบข้อความภาษาไทย', () => {
    assert.equal(C.durText(450), '7 ชม. 30 นาที');
    assert.equal(C.durText(540), '9 ชม.');
    assert.equal(C.durText(45), '45 นาที');
    assert.equal(C.durText(0), '0 นาที');
  });
  test('hoursText แปลงชั่วโมงทศนิยม', () => {
    assert.equal(C.hoursText(7.5), '7 ชม. 30 นาที');
    assert.equal(C.hoursText(0.25), '15 นาที');
  });
});

/* ---------------------------------------------------------
   hoursBetween — การนอนข้ามเที่ยงคืน
   --------------------------------------------------------- */
describe('hoursBetween', () => {
  test('นอนข้ามเที่ยงคืน (เคสปกติที่สุด)', () => {
    assert.equal(C.hoursBetween('23:00', '07:00'), 8);
    assert.equal(C.hoursBetween('23:30', '06:15'), 6.75);
    assert.equal(C.hoursBetween('00:30', '08:00'), 7.5);
  });

  test('นอนกลางวัน ไม่ข้ามเที่ยงคืน', () => {
    assert.equal(C.hoursBetween('13:00', '15:30'), 2.5);
  });

  test('เข้านอนพอดีเที่ยงคืน', () => {
    assert.equal(C.hoursBetween('00:00', '07:00'), 7);
  });

  test('ตื่นพอดีเที่ยงคืน', () => {
    assert.equal(C.hoursBetween('16:00', '00:00'), 8);
  });

  test('เวลาเข้านอนเท่ากับเวลาตื่น = ครบ 24 ชม. ไม่ใช่ 0', () => {
    assert.equal(C.hoursBetween('07:00', '07:00'), 24);
  });

  test('ปัดทศนิยม 2 ตำแหน่ง ไม่มี floating point error', () => {
    assert.equal(C.hoursBetween('23:10', '06:50'), 7.67);
  });
});

/* ---------------------------------------------------------
   computeDebt — หัวใจของฟีเจอร์หนี้การนอน
   --------------------------------------------------------- */
describe('computeDebt', () => {
  const cfg = { ageGroup: 'young', debtWindow: 7 };   // เกณฑ์ขั้นต่ำ 7 ชม.
  const now = at(2026, 8, 2, 10, 0);

  /** สร้าง logs ย้อนหลังจาก now: hours[0] = วันนี้, hours[1] = เมื่อวาน ... */
  function logsFrom(hours, base = now) {
    const logs = {};
    hours.forEach((h, i) => {
      if (h === null) return;                    // null = วันที่ไม่ได้บันทึก
      logs[C.dateKey(C.addDays(base, -i))] = { bed: '23:00', wake: '07:00', hours: h };
    });
    return logs;
  }

  test('ไม่มีข้อมูลเลย → หนี้ = 0 และสถานะ none', () => {
    const r = C.computeDebt({}, cfg, now);
    assert.equal(r.debt, 0);
    assert.equal(r.logged, 0);
    assert.equal(r.missing, 7);
    assert.equal(r.level, 'none');
    assert.equal(r.avg, 0);
  });

  test('นอนครบทุกคืน → ไม่มีหนี้', () => {
    const r = C.computeDebt(logsFrom([7, 7, 7, 7, 7, 7, 7]), cfg, now);
    assert.equal(r.debt, 0);
    assert.equal(r.logged, 7);
    assert.equal(r.level, 'ok');
  });

  test('ขาดทุกคืนคืนละ 2 ชม. → หนี้ 14 ชม.', () => {
    const r = C.computeDebt(logsFrom([5, 5, 5, 5, 5, 5, 5]), cfg, now);
    assert.equal(r.debt, 14);
    assert.equal(r.level, 'severe');
    assert.equal(r.avg, 5);
  });

  test('วันที่ไม่ได้บันทึกต้องถูกข้าม ไม่นับเป็นหนี้', () => {
    // บันทึกแค่ 2 วัน ขาดวันละ 1 ชม. → หนี้ 2 ชม. (ไม่ใช่ 5 วันที่หายไป × 7 ชม.)
    const r = C.computeDebt(logsFrom([6, 6, null, null, null, null, null]), cfg, now);
    assert.equal(r.debt, 2);
    assert.equal(r.logged, 2);
    assert.equal(r.missing, 5);
  });

  test('นอนเกินชดเชยได้สูงสุดวันละ 1 ชม.', () => {
    // คืนแรกขาด 3 ชม., คืนที่สองนอน 12 ชม. (เกิน 5) → ชดเชยได้แค่ 1 → หนี้เหลือ 2
    const r = C.computeDebt(logsFrom([4, 12]), cfg, now);
    assert.equal(r.debt, 2);
  });

  test('หนี้ไม่ติดลบ แม้จะนอนเกินตลอด', () => {
    const r = C.computeDebt(logsFrom([9, 9, 9, 9, 9, 9, 9]), cfg, now);
    assert.equal(r.debt, 0);
    assert.equal(r.level, 'ok');
  });

  test('บันทึกที่เก่ากว่ากรอบเวลาต้องไม่ถูกนับ', () => {
    const logs = logsFrom([5, 5, 5, 5, 5, 5, 5]);            // 7 วันในกรอบ = หนี้ 14
    logs[C.dateKey(C.addDays(now, -7))] = { bed: '2:00', wake: '4:00', hours: 2 };  // นอกกรอบ
    logs[C.dateKey(C.addDays(now, -30))] = { bed: '2:00', wake: '4:00', hours: 1 };
    const r = C.computeDebt(logs, cfg, now);
    assert.equal(r.debt, 14);
    assert.equal(r.logged, 7);
  });

  test('บันทึกของอนาคตต้องไม่ถูกนับ', () => {
    const logs = logsFrom([5]);
    logs[C.dateKey(C.addDays(now, 1))] = { bed: '23:00', wake: '01:00', hours: 2 };
    const r = C.computeDebt(logs, cfg, now);
    assert.equal(r.logged, 1);
    assert.equal(r.debt, 2);
  });

  test('กรอบเวลาข้ามเดือนและข้ามปีได้ถูกต้อง', () => {
    const nye = at(2027, 1, 2, 10, 0);
    const r = C.computeDebt(logsFrom([5, 5, 5, 5, 5, 5, 5], nye), cfg, nye);
    assert.equal(r.logged, 7);
    assert.equal(r.debt, 14);
    assert.equal(r.days[0].key, '2026-12-27');   // วันแรกของกรอบอยู่ในปีก่อน
    assert.equal(r.days[6].key, '2027-01-02');
  });

  test('เกณฑ์เปลี่ยนตามช่วงอายุ', () => {
    const logs = logsFrom([9, 9, 9, 9, 9, 9, 9]);
    assert.equal(C.computeDebt(logs, { ageGroup: 'young', debtWindow: 7 }, now).debt, 0);    // เกณฑ์ 7
    assert.equal(C.computeDebt(logs, { ageGroup: 'school', debtWindow: 7 }, now).debt, 0);   // เกณฑ์ 9
    assert.equal(C.computeDebt(logs, { ageGroup: 'toddler', debtWindow: 7 }, now).debt, 14); // เกณฑ์ 11
  });

  test('days เรียงจากเก่าไปใหม่ และมีจำนวนเท่ากับกรอบเวลา', () => {
    const r = C.computeDebt({}, { ageGroup: 'adult', debtWindow: 14 }, now);
    assert.equal(r.days.length, 14);
    assert.equal(r.days[0].key, '2026-07-20');
    assert.equal(r.days[13].key, '2026-08-02');
  });

  test('ข้ามบันทึกที่ hours เสียหาย (NaN / undefined)', () => {
    const logs = logsFrom([5]);
    logs[C.dateKey(C.addDays(now, -1))] = { bed: '23:00', wake: '07:00' };        // ไม่มี hours
    logs[C.dateKey(C.addDays(now, -2))] = { bed: 'x', wake: 'y', hours: NaN };
    const r = C.computeDebt(logs, cfg, now);
    assert.equal(r.logged, 1);
    assert.equal(r.debt, 2);
  });

  test('ระดับความรุนแรงตรงตามช่วง รวมค่าที่ขอบพอดี', () => {
    const level = hours => C.computeDebt(logsFrom(hours), cfg, now).level;
    assert.equal(level([7]), 'ok');            // หนี้ 0
    assert.equal(level([6.5]), 'ok');          // หนี้ 0.5 — ต่ำกว่า 1
    assert.equal(level([6]), 'low');           // หนี้ 1   — ขอบล่างของ low
    assert.equal(level([5]), 'low');           // หนี้ 2
    assert.equal(level([2]), 'high');          // หนี้ 5   — ขอบล่างของ high
    assert.equal(level([3, 3]), 'high');       // หนี้ 8
    assert.equal(level([1, 1]), 'severe');     // หนี้ 12  — ขอบล่างของ severe
    assert.equal(level([0.5, 0.5]), 'severe'); // หนี้ 13
  });

  test('ไม่มี floating point error สะสมในผลรวม', () => {
    const r = C.computeDebt(logsFrom([6.1, 6.2, 6.3]), cfg, now);
    assert.equal(r.debt, 2.4);        // ไม่ใช่ 2.4000000000000004
  });
});

/* ---------------------------------------------------------
   planBedtime
   --------------------------------------------------------- */
describe('planBedtime', () => {
  const cfg = { usualWake: '07:00', latency: 15, cycleLen: 90 };
  const f = lvl => C.fatigueOf(lvl);

  test('กลางคืนก่อนถึงเวลานอน → บอกเวลาเป้าหมายและนับถอยหลัง', () => {
    // lvl1 (ปกติ): 5 รอบ = 450 นาที, เข้านอน = 07:00 - 450 - 15 = 23:15
    const p = C.planBedtime(f(1), cfg, at(2026, 8, 2, 21, 0));
    assert.equal(p.bedLabel, '23:15');
    assert.equal(p.bedNote, 'อีก 2 ชม. 15 นาที จากนี้');
    assert.equal(C.minToHM(p.wakeMin), '07:00');
    assert.equal(p.urgent, false);
  });

  test('เลยเวลานอนแล้ว → "ตอนนี้เลย" พร้อมบอกว่าเลยมาเท่าไหร่', () => {
    const p = C.planBedtime(f(1), cfg, at(2026, 8, 2, 23, 40));
    assert.equal(p.bedLabel, 'ตอนนี้เลย');
    assert.match(p.bedNote, /เลยเวลาที่ควรเข้านอน \(23:15\) มาแล้ว 25 นาที/);
    assert.equal(C.minToHM(p.wakeMin), '07:25');
    assert.equal(p.urgent, true);
  });

  test('ตีสองแล้วยังไม่นอน → ต้องไม่แนะนำให้รอถึงคืนถัดไป', () => {
    // จุดที่เคยพลาด: 23:15 ของ "เมื่อวาน" ต้องถูกมองว่าเลยมาแล้ว ไม่ใช่อีก 21 ชม.
    const p = C.planBedtime(f(1), cfg, at(2026, 8, 2, 2, 0));
    assert.equal(p.bedLabel, 'ตอนนี้เลย');
    assert.match(p.bedNote, /มาแล้ว 2 ชม. 45 นาที/);
  });

  test('หมดแรงตอนหัวค่ำ → บีบให้เข้านอนภายใน maxWait', () => {
    // lvl3 (หมดแรง): 6 รอบ = 540, เข้านอนปกติ = 07:00-540-15 = 21:45, เร็วขึ้น 90 → 20:15
    // ตอน 18:30 เป้าหมายอยู่อีก 105 นาที > maxWait 30 → บีบเป็น 19:00
    const p = C.planBedtime(f(3), cfg, at(2026, 8, 2, 18, 30));
    assert.equal(p.bedLabel, '19:00');
    assert.match(p.bedNote, /ไม่ควรรอถึง 20:15 — เข้านอนภายใน 30 นาที/);
    assert.equal(p.urgent, true);
  });

  test('กลางวัน → แนะนำเวลานอนของคืนนี้ ไม่บีบให้นอนตอนบ่าย', () => {
    const p = C.planBedtime(f(3), cfg, at(2026, 8, 2, 14, 30));
    assert.equal(p.bedLabel, '20:15');
    assert.match(p.bedNote, /^คืนนี้ — อีก 5 ชม. 45 นาที จากนี้$/);
    assert.equal(p.urgent, false);
  });

  test('กลางวันและล้าหนัก → แนะนำให้งีบ', () => {
    const p = C.planBedtime(f(3), cfg, at(2026, 8, 2, 14, 0));
    assert.ok(p.extraTips.some(t => t.includes('งีบ 20 นาที')));
  });

  test('กลางวันแต่ยังไม่ล้า → ไม่แนะนำให้งีบ', () => {
    const p = C.planBedtime(f(1), cfg, at(2026, 8, 2, 14, 0));
    assert.ok(!p.extraTips.some(t => t.includes('งีบ')));
  });

  test('ยิ่งล้ายิ่งนอนเร็วขึ้นและนอนนานขึ้น', () => {
    const evening = at(2026, 8, 2, 19, 0);
    const targets = C.FATIGUE.map(x => C.planBedtime(f(x.lvl), cfg, evening).targetMin);
    for (let i = 1; i < targets.length; i++) {
      assert.ok(targets[i] <= targets[i - 1], `ระดับ ${i + 1} ต้องไม่นอนช้ากว่าระดับ ${i}`);
    }
    assert.equal(C.planBedtime(f(1), cfg, evening).sleepNeed, 450);
    assert.equal(C.planBedtime(f(3), cfg, evening).sleepNeed, 540);
  });

  test('เวลาเข้านอนที่คำนวณได้ต้องข้ามเที่ยงคืนได้ถูกต้อง', () => {
    // ตื่น 04:00, นอน 5 รอบ → เข้านอน 04:00 - 450 - 15 = 20:15 ของวันก่อน
    const late = { usualWake: '04:00', latency: 15, cycleLen: 90 };
    const p = C.planBedtime(f(1), late, at(2026, 8, 2, 19, 0));
    assert.equal(p.bedLabel, '20:15');
    assert.equal(C.minToHM(p.wakeMin), '04:00');
  });

  test('รองรับ cycleLen / latency ที่ผู้ใช้ปรับเอง', () => {
    const custom = { usualWake: '06:30', latency: 30, cycleLen: 100 };
    // 5 รอบ = 500 นาที → เข้านอน = 06:30 - 500 - 30 = 21:40
    const p = C.planBedtime(f(1), custom, at(2026, 8, 2, 20, 0));
    assert.equal(p.bedLabel, '21:40');
    assert.equal(C.minToHM(p.wakeMin), '06:30');
  });
});

/* ---------------------------------------------------------
   cycleOptions
   --------------------------------------------------------- */
describe('cycleOptions', () => {
  const cfg = { latency: 15, cycleLen: 90 };

  test('โหมดเข้านอน → คืนเวลาตื่น 4 ตัวเลือก เรียง 3→6 รอบ', () => {
    const o = C.cycleOptions('bed', C.parseHM('22:30'), cfg);
    assert.deepEqual(o.map(x => x.time), ['03:15', '04:45', '06:15', '07:45']);
    assert.deepEqual(o.map(x => x.cycles), [3, 4, 5, 6]);
  });

  test('โหมดเวลาตื่น → คืนเวลาเข้านอน เรียง 6→3 รอบ', () => {
    const o = C.cycleOptions('wake', C.parseHM('06:30'), cfg);
    assert.deepEqual(o.map(x => x.time), ['21:15', '22:45', '00:15', '01:45']);
    assert.deepEqual(o.map(x => x.cycles), [6, 5, 4, 3]);
  });

  test('โหมด now ทำงานเหมือนโหมด bed', () => {
    const a = C.cycleOptions('now', 1350, cfg);
    const b = C.cycleOptions('bed', 1350, cfg);
    assert.deepEqual(a, b);
  });

  test('5 และ 6 รอบถูกจัดเป็น "แนะนำ"', () => {
    const o = C.cycleOptions('bed', 1350, cfg);
    assert.deepEqual(o.filter(x => x.rank === 'best').map(x => x.cycles), [5, 6]);
    assert.equal(o.find(x => x.cycles === 4).rank, 'ok');
    assert.equal(o.find(x => x.cycles === 3).rank, 'min');
  });

  test('เวลาที่ข้ามเที่ยงคืนแสดงถูกต้อง ไม่กลายเป็น 25:00', () => {
    const o = C.cycleOptions('bed', C.parseHM('23:00'), cfg);
    assert.equal(o[0].time, '03:45');
    assert.ok(o.every(x => x.minutes >= 0 && x.minutes < 1440));
  });

  test('ระยะเวลารวมตรงกับจำนวนรอบ', () => {
    const o = C.cycleOptions('bed', 0, { latency: 0, cycleLen: 90 });
    assert.equal(o.find(x => x.cycles === 5).totalText, '7 ชม. 30 นาที');
    assert.equal(o.find(x => x.cycles === 6).totalMin, 540);
  });
});

/* ---------------------------------------------------------
   defaults / migrate
   --------------------------------------------------------- */
describe('migrate', () => {
  test('ไม่มีข้อมูลเดิม → ได้ค่าเริ่มต้นครบ', () => {
    const s = C.migrate(null);
    assert.equal(s.version, C.STATE_VERSION);
    assert.equal(s.ageGroup, 'young');
    assert.deepEqual(s.sleepLogs, {});
    assert.deepEqual(s.tasks, []);
  });

  test('อัปเกรดจาก v1 โดยไม่ทำข้อมูลผู้ใช้หาย', () => {
    const v1 = {
      ageGroup: 'adult', usualWake: '06:00', latency: 20, cycleLen: 90, debtWindow: 21,
      sleepLogs: { '2026-08-01': { bed: '23:00', wake: '07:00', hours: 8 } },
      fatigueLogs: { '2026-08-01': { lvl: 3, at: '21:40' } },
      tasks: [{ id: 1, text: 'ส่งรายงาน', pri: 'high', done: false }],
      remindTime: '06:30', remindOn: true, volume: 80,
    };
    const sleepLogsBefore = JSON.parse(JSON.stringify(v1.sleepLogs));
    const tasksBefore = JSON.parse(JSON.stringify(v1.tasks));
    const s = C.migrate(v1);
    assert.equal(s.version, C.STATE_VERSION);
    assert.equal(s.ageGroup, 'adult');
    assert.equal(s.usualWake, '06:00');
    assert.equal(s.latency, 20);
    assert.equal(s.debtWindow, 21);
    assert.deepEqual(s.sleepLogs, sleepLogsBefore);
    // ความล้าเดิม lvl3 "เริ่มล้า" ของสเกล 5 ระดับ ต้องกลายเป็น lvl2 "เริ่มล้า" ของสเกล 3 ระดับ
    assert.deepEqual(s.fatigueLogs, { '2026-08-01': { lvl: 2, at: '21:40' } });
    assert.deepEqual(s.tasks, tasksBefore);
    assert.equal(s.remindOn, true);
    assert.equal(s.volume, 80);
  });

  test('เติมฟิลด์ที่ขาดจาก state เก่าที่ไม่ครบ', () => {
    const s = C.migrate({ ageGroup: 'teen' });
    assert.equal(s.ageGroup, 'teen');
    assert.equal(s.cycleLen, 90);
    assert.equal(s.remindTime, '07:00');
    assert.deepEqual(s.tasks, []);
  });

  test('ซ่อมค่าที่อยู่นอกช่วงที่ยอมรับได้', () => {
    const s = C.migrate({ latency: 999, cycleLen: 5, debtWindow: 400, volume: -20, ageGroup: 'ไม่มีจริง' });
    assert.equal(s.latency, 45);
    assert.equal(s.cycleLen, 80);
    assert.equal(s.debtWindow, 30);
    assert.equal(s.volume, 0);
    assert.equal(s.ageGroup, 'young');
  });

  test('ซ่อมโครงสร้างที่ผิดชนิด', () => {
    const s = C.migrate({ tasks: 'ไม่ใช่อาเรย์', sleepLogs: 42, fatigueLogs: null });
    assert.deepEqual(s.tasks, []);
    assert.deepEqual(s.sleepLogs, {});
    assert.deepEqual(s.fatigueLogs, {});
  });

  test('state ที่เป็นเวอร์ชันปัจจุบันแล้วต้องไม่ถูกแก้', () => {
    const cur = C.migrate({ version: C.STATE_VERSION, ageGroup: 'senior', volume: 55 });
    assert.equal(cur.ageGroup, 'senior');
    assert.equal(cur.volume, 55);
  });

  test('migrate แล้วผลลัพธ์ใช้กับ computeDebt ได้ทันที', () => {
    const s = C.migrate({ sleepLogs: { [C.dateKey(new Date())]: { bed: '01:00', wake: '06:00', hours: 5 } } });
    const r = C.computeDebt(s.sleepLogs, s, new Date());
    assert.equal(r.logged, 1);
    assert.equal(r.debt, 2);
  });
});

/* ---------------------------------------------------------
   ข้อมูลอ้างอิง
   --------------------------------------------------------- */
describe('ข้อมูลอ้างอิง', () => {
  test('ชาร์ตเวลานอนครบ 9 ช่วงวัย และ min <= max เสมอ', () => {
    assert.equal(C.AGE_GROUPS.length, 9);
    C.AGE_GROUPS.forEach(g => {
      assert.ok(g.min <= g.max, `${g.id}: min ต้องไม่มากกว่า max`);
      assert.ok(g.label && g.id);
    });
  });

  test('ageGroupOf คืนค่าเริ่มต้นเมื่อไม่พบ', () => {
    assert.equal(C.ageGroupOf('young').id, 'young');
    assert.equal(C.ageGroupOf('ไม่มีจริง').id, 'young');
    assert.equal(C.ageGroupOf(undefined).id, 'young');
  });

  test('ระดับความล้าครบ 3 ระดับ เรียงตามความรุนแรง', () => {
    assert.equal(C.FATIGUE.length, 3);
    C.FATIGUE.forEach((f, i) => {
      assert.equal(f.lvl, i + 1);
      assert.ok(f.cycles >= 5 && f.cycles <= 6);
      assert.ok(f.tips.length > 0);
      if (i > 0) assert.ok(f.earlier >= C.FATIGUE[i - 1].earlier);
    });
  });

  test('fatigueOf คืน null เมื่อไม่พบ', () => {
    assert.equal(C.fatigueOf(3).lvl, 3);
    assert.equal(C.fatigueOf(99), null);
  });

  test('บันทึกความล้าสเกลเก่า 5 ระดับ ถูกยุบเป็น 3 ระดับครบทุกค่า', () => {
    const s = C.migrate({
      version: 6,
      fatigueLogs: {
        '2026-08-01': { lvl: 1, at: '21:00' },   // สดชื่น  → ปกติ
        '2026-08-02': { lvl: 2, at: '21:00' },   // พอไหว   → ปกติ
        '2026-08-03': { lvl: 3, at: '21:00' },   // เริ่มล้า → เริ่มล้า
        '2026-08-04': { lvl: 4, at: '21:00' },   // ล้ามาก  → หมดแรง
        '2026-08-05': { lvl: 5, at: '21:00' },   // หมดแรง  → หมดแรง
      },
    });
    assert.deepEqual(
      Object.keys(s.fatigueLogs).map(k => s.fatigueLogs[k].lvl),
      [1, 1, 2, 3, 3]
    );
    // ทุกระดับที่เหลือต้องหาเจอจริงใน FATIGUE
    Object.values(s.fatigueLogs).forEach(r => assert.ok(C.fatigueOf(r.lvl)));
  });

  test('แปลงบันทึกความล้าซ้ำไม่ทำให้ระดับเพี้ยน', () => {
    // เคยพลาด: ถ้าแปลงทุกครั้งที่โหลด ระดับที่ผู้ใช้เพิ่งเลือกจะถูกลดลงเรื่อย ๆ
    let s = C.migrate({ version: 6, fatigueLogs: { '2026-08-03': { lvl: 3, at: '21:00' } } });
    assert.equal(s.fatigueLogs['2026-08-03'].lvl, 2);
    for (let i = 0; i < 3; i++) s = C.migrate(JSON.parse(JSON.stringify(s)));
    assert.equal(s.fatigueLogs['2026-08-03'].lvl, 2);
  });

  test('ทิ้งบันทึกความล้าที่ระดับไม่มีอยู่จริง', () => {
    const s = C.migrate({ version: C.STATE_VERSION, fatigueLogs: { '2026-08-01': { lvl: 9 }, '2026-08-02': null } });
    assert.deepEqual(s.fatigueLogs, {});
  });
});
