/* =========================================================
   TimeSync — unit tests สำหรับตารางที่ไม่คงที่ (Phase 3)
   ========================================================= */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);

// 2026-08-02 = วันอาทิตย์ (getDay 0), 2026-08-03 = วันจันทร์ (getDay 1)
const SUN = at(2026, 8, 2, 12, 0);
const MON = at(2026, 8, 3, 12, 0);

function st(over) {
  return C.migrate(Object.assign({ version: C.STATE_VERSION, latency: 15, cycleLen: 90 }, over));
}

/* ---------------------------------------------------------
   scheduleFor — ลำดับความสำคัญของตาราง
   --------------------------------------------------------- */
describe('scheduleFor', () => {
  test('โหมดง่าย → ใช้ค่าเดียวกันทุกวัน', () => {
    const s = st({ schedule: { mode: 'simple', simple: { bed: '', wake: '07:00' } } });
    assert.equal(C.scheduleFor(s, SUN).wake, '07:00');
    assert.equal(C.scheduleFor(s, MON).wake, '07:00');
    assert.equal(C.scheduleFor(s, SUN).source, 'simple');
  });

  test('โหมดรายวัน → แต่ละวันใช้ค่าของตัวเอง', () => {
    const s = st({
      schedule: {
        mode: 'weekly',
        simple: { wake: '07:00' },
        weekly: { 0: { wake: '09:30' }, 1: { wake: '06:00' } },
      },
    });
    assert.equal(C.scheduleFor(s, SUN).wake, '09:30');
    assert.equal(C.scheduleFor(s, SUN).source, 'weekly');
    assert.equal(C.scheduleFor(s, MON).wake, '06:00');
  });

  test('วันที่ยังไม่ได้ตั้งในโหมดรายวัน → ถอยไปใช้โหมดง่าย', () => {
    const s = st({
      schedule: { mode: 'weekly', simple: { wake: '07:00' }, weekly: { 1: { wake: '06:00' } } },
    });
    const sun = C.scheduleFor(s, SUN);
    assert.equal(sun.wake, '07:00');
    assert.equal(sun.source, 'simple');
  });

  test('override เฉพาะวันชนะทุกอย่าง', () => {
    const s = st({
      schedule: {
        mode: 'weekly',
        simple: { wake: '07:00' },
        weekly: { 1: { wake: '06:00' } },
        overrides: { '2026-08-03': { wake: '04:30', note: 'บินเช้า' } },
      },
    });
    const r = C.scheduleFor(s, MON);
    assert.equal(r.wake, '04:30');
    assert.equal(r.source, 'override');
    assert.equal(r.note, 'บินเช้า');
  });

  test('override ใช้ได้แม้อยู่ในโหมดง่าย', () => {
    const s = st({
      schedule: { mode: 'simple', simple: { wake: '07:00' }, overrides: { '2026-08-03': { wake: '05:00' } } },
    });
    assert.equal(C.scheduleFor(s, MON).wake, '05:00');
    assert.equal(C.scheduleFor(s, SUN).wake, '07:00');   // วันอื่นไม่กระทบ
  });

  test('override ที่ไม่มีเวลาตื่น ถือว่าไม่มีผล', () => {
    const s = st({ schedule: { mode: 'simple', simple: { wake: '07:00' }, overrides: { '2026-08-03': { bed: '01:00' } } } });
    assert.equal(C.scheduleFor(s, MON).wake, '07:00');
  });

  test('เวลาเข้านอนที่ตั้งเองต้องถูกส่งต่อมาด้วย', () => {
    const s = st({ schedule: { mode: 'weekly', simple: { wake: '07:00' }, weekly: { 1: { bed: '01:00', wake: '09:00' } } } });
    assert.equal(C.scheduleFor(s, MON).bed, '01:00');
  });
});

/* ---------------------------------------------------------
   sleepTargetDate — การนอนรอบถัดไปไปตื่นวันไหน
   --------------------------------------------------------- */
describe('sleepTargetDate', () => {
  test('ตอนหัวค่ำ → ตื่นพรุ่งนี้', () => {
    assert.equal(C.dateKey(C.sleepTargetDate(at(2026, 8, 2, 22, 0))), '2026-08-03');
  });

  test('ตอนกลางวัน → เตรียมนอนคืนนี้ ตื่นพรุ่งนี้', () => {
    assert.equal(C.dateKey(C.sleepTargetDate(at(2026, 8, 2, 14, 0))), '2026-08-03');
  });

  test('ตีสอง → ยังเป็นคืนของเมื่อวาน ตื่นวันนี้', () => {
    assert.equal(C.dateKey(C.sleepTargetDate(at(2026, 8, 2, 2, 0))), '2026-08-02');
  });

  test('ขอบเวลา 05:00', () => {
    assert.equal(C.dateKey(C.sleepTargetDate(at(2026, 8, 2, 4, 59))), '2026-08-02');
    assert.equal(C.dateKey(C.sleepTargetDate(at(2026, 8, 2, 5, 0))), '2026-08-03');
  });

  test('ข้ามสิ้นเดือน', () => {
    assert.equal(C.dateKey(C.sleepTargetDate(at(2026, 8, 31, 22, 0))), '2026-09-01');
  });
});

/* ---------------------------------------------------------
   wakeTimeFor / bedtimeMinFor
   --------------------------------------------------------- */
describe('wakeTimeFor / bedtimeMinFor', () => {
  test('คืนวันอาทิตย์ใช้เวลาตื่นของวันจันทร์', () => {
    const s = st({
      schedule: { mode: 'weekly', simple: { wake: '07:00' }, weekly: { 0: { wake: '09:30' }, 1: { wake: '06:00' } } },
    });
    // 22:00 ของวันอาทิตย์ → นอนแล้วไปตื่นวันจันทร์ 06:00
    assert.equal(C.wakeTimeFor(s, at(2026, 8, 2, 22, 0)), '06:00');
    // บ่ายวันอาทิตย์ก็ยังวางแผนสำหรับคืนนี้เหมือนกัน
    assert.equal(C.wakeTimeFor(s, at(2026, 8, 2, 14, 0)), '06:00');
    // ตี 2 ของวันอาทิตย์ → ยังเป็นคืนวันเสาร์ ตื่นเช้าวันอาทิตย์ 09:30
    assert.equal(C.wakeTimeFor(s, at(2026, 8, 2, 2, 0)), '09:30');
  });

  test('คำนวณเวลาเข้านอนจากเวลาตื่นของวันนั้น', () => {
    const s = st({ schedule: { mode: 'weekly', simple: { wake: '07:00' }, weekly: { 1: { wake: '06:00' } } } });
    // ตื่น 06:00 − 450 − 15 = 22:15
    assert.equal(C.minToHM(C.bedtimeMinFor(s, at(2026, 8, 2, 20, 0))), '22:15');
  });

  test('ถ้าตั้งเวลาเข้านอนไว้เอง ใช้ค่านั้นแทนการคำนวณ', () => {
    const s = st({ schedule: { mode: 'weekly', simple: { wake: '07:00' }, weekly: { 1: { bed: '00:30', wake: '09:00' } } } });
    assert.equal(C.minToHM(C.bedtimeMinFor(s, at(2026, 8, 2, 20, 0))), '00:30');
  });

  test('override มีผลกับเวลาเข้านอนของคืนก่อนหน้าด้วย', () => {
    const s = st({
      schedule: { mode: 'simple', simple: { wake: '07:00' }, overrides: { '2026-08-03': { wake: '04:00' } } },
    });
    // คืนวันที่ 2 ต้องเข้านอนเร็วขึ้นเพราะพรุ่งนี้ต้องตื่นตี 4 → 04:00 − 465 = 20:15
    assert.equal(C.minToHM(C.bedtimeMinFor(s, at(2026, 8, 2, 19, 0))), '20:15');
  });

  test('โหมดง่ายให้ผลเท่ากับ usualBedtimeMin เดิม', () => {
    const s = st({ schedule: { mode: 'simple', simple: { wake: '07:00' } } });
    assert.equal(
      C.bedtimeMinFor(s, at(2026, 8, 2, 20, 0)),
      C.usualBedtimeMin({ usualWake: '07:00', cycleLen: 90, latency: 15 })
    );
  });
});

/* ---------------------------------------------------------
   setOverride / pruneOverrides
   --------------------------------------------------------- */
describe('override เฉพาะวัน', () => {
  test('ตั้งแล้วไม่กระทบตารางประจำ', () => {
    const s = st({ schedule: { mode: 'weekly', simple: { wake: '07:00' }, weekly: { 1: { wake: '06:00' } } } });
    C.setOverride(s, '2026-08-03', { wake: '04:30' });
    assert.equal(C.scheduleFor(s, MON).wake, '04:30');
    assert.equal(s.schedule.weekly[1].wake, '06:00');          // ตารางประจำเหมือนเดิม
    assert.equal(C.scheduleFor(s, at(2026, 8, 10, 12, 0)).wake, '06:00');  // จันทร์ถัดไปกลับมาปกติ
  });

  test('ลบ override ได้ด้วยการส่งค่าว่าง', () => {
    const s = st({ schedule: { mode: 'simple', simple: { wake: '07:00' } } });
    C.setOverride(s, '2026-08-03', { wake: '04:30' });
    C.setOverride(s, '2026-08-03', null);
    assert.equal(C.scheduleFor(s, MON).wake, '07:00');
    assert.deepEqual(s.schedule.overrides, {});
  });

  test('เก็บโน้ตประกอบได้', () => {
    const s = st({});
    C.setOverride(s, '2026-08-03', { wake: '04:30', note: 'บินเช้า' });
    assert.equal(s.schedule.overrides['2026-08-03'].note, 'บินเช้า');
  });

  test('ลบ override ที่เลยวันไปแล้ว แต่เก็บของวันนี้และอนาคตไว้', () => {
    const s = st({
      schedule: {
        mode: 'simple', simple: { wake: '07:00' },
        overrides: {
          '2026-07-30': { wake: '05:00' },   // อดีต
          '2026-08-02': { wake: '06:00' },   // วันนี้
          '2026-08-05': { wake: '04:00' },   // อนาคต
        },
      },
    });
    C.pruneOverrides(s, SUN);
    assert.deepEqual(Object.keys(s.schedule.overrides).sort(), ['2026-08-02', '2026-08-05']);
  });
});

/* ---------------------------------------------------------
   effectiveAlarmTime
   --------------------------------------------------------- */
describe('effectiveAlarmTime', () => {
  test('ปิด followSchedule → ใช้เวลาปลุกที่ตั้งไว้ตายตัว', () => {
    const s = st({
      alarm: { time: '07:00', followSchedule: false },
      schedule: { mode: 'weekly', simple: { wake: '07:00' }, weekly: { 1: { wake: '05:00' } } },
    });
    assert.equal(C.effectiveAlarmTime(s, MON), '07:00');
  });

  test('เปิด followSchedule ก่อนถึงเวลาตื่น → ใช้เวลาของวันนี้', () => {
    const s = st({
      alarm: { time: '07:00', followSchedule: true },
      schedule: { mode: 'weekly', simple: { wake: '07:00' }, weekly: { 0: { wake: '09:30' }, 1: { wake: '05:00' } } },
    });
    // ตี 3 วันจันทร์ ยังไม่ถึง 05:00 → ใช้ของวันจันทร์
    assert.equal(C.effectiveAlarmTime(s, at(2026, 8, 3, 3, 0)), '05:00');
    // 08:00 วันอาทิตย์ เพิ่งเลย 09:30 หรือยัง? ยังไม่ถึง → ใช้ของวันอาทิตย์
    assert.equal(C.effectiveAlarmTime(s, at(2026, 8, 2, 8, 0)), '09:30');
  });

  test('เลยเวลาตื่นของวันนี้ไปแล้ว → แสดงเวลาของพรุ่งนี้', () => {
    const s = st({
      alarm: { time: '07:00', followSchedule: true },
      schedule: { mode: 'weekly', simple: { wake: '07:00' }, weekly: { 0: { wake: '09:30' }, 1: { wake: '05:00' } } },
    });
    // หัวค่ำวันอาทิตย์ — ครั้งต่อไปคือเช้าวันจันทร์ 05:00 ไม่ใช่ 09:30 ของวันนี้
    assert.equal(C.effectiveAlarmTime(s, at(2026, 8, 2, 20, 0)), '05:00');
  });

  test('ยังอยู่ในช่วง grace หลังเวลาตื่น → ยังใช้ของวันนี้', () => {
    const s = st({
      alarm: { time: '07:00', followSchedule: true },
      schedule: { mode: 'weekly', simple: { wake: '07:00' }, weekly: { 0: { wake: '09:30' }, 1: { wake: '05:00' } } },
    });
    assert.equal(C.effectiveAlarmTime(s, at(2026, 8, 2, 9, 45)), '09:30');   // เลยมา 15 นาที
    assert.equal(C.effectiveAlarmTime(s, at(2026, 8, 2, 10, 30)), '05:00');  // เลยมา 60 นาที → ของพรุ่งนี้
  });

  test('followSchedule เคารพ override ด้วย', () => {
    const s = st({
      alarm: { time: '07:00', followSchedule: true },
      schedule: { mode: 'simple', simple: { wake: '07:00' }, overrides: { '2026-08-03': { wake: '04:15' } } },
    });
    assert.equal(C.effectiveAlarmTime(s, at(2026, 8, 3, 2, 0)), '04:15');   // ตี 2 วันจันทร์
    assert.equal(C.effectiveAlarmTime(s, at(2026, 8, 2, 20, 0)), '04:15');  // หัวค่ำวันอาทิตย์ มองไปพรุ่งนี้
  });
});

/* ---------------------------------------------------------
   การเตือนต้องเดินตามตาราง
   --------------------------------------------------------- */
describe('dueReminders กับตารางรายวัน', () => {
  test('เตือนก่อนนอนเลื่อนตามเวลาตื่นของพรุ่งนี้', () => {
    const s = st({
      lastBed: '23:00', lastWake: '07:00',
      sleepLogs: { '2026-08-02': { bed: '1', wake: '2', hours: 8 } },
      reminders: { log: { on: false }, bedtime: { on: true, leadMin: 0 }, alarmMissing: { on: false } },
      schedule: { mode: 'weekly', simple: { wake: '07:00' }, weekly: { 1: { wake: '05:00' } } },
    });
    // พรุ่งนี้ (จันทร์) ต้องตื่นตี 5 → คืนนี้ต้องนอน 05:00 − 465 = 21:15
    assert.equal(C.dueReminders(s, at(2026, 8, 2, 21, 15)).length, 1);
    assert.equal(C.dueReminders(s, at(2026, 8, 2, 23, 15)).length, 0);   // เวลาเดิมไม่เตือนแล้ว
  });
});

/* ---------------------------------------------------------
   migrate v4 → v5
   --------------------------------------------------------- */
describe('migrate v4 → v5', () => {
  test('ยกเวลาตื่นเดิมมาเป็นโหมดง่าย ผู้ใช้ไม่รู้สึกว่าอะไรเปลี่ยน', () => {
    const s = C.migrate({ version: 4, usualWake: '06:30' });
    assert.equal(s.version, C.STATE_VERSION);
    assert.equal(s.schedule.mode, 'simple');
    assert.equal(s.schedule.simple.wake, '06:30');
    assert.equal(s.usualWake, '06:30');
  });

  test('อัปเกรดข้ามจาก v1 ถึงเวอร์ชันล่าสุดได้ครบทุกชั้น', () => {
    const s = C.migrate({
      ageGroup: 'teen', usualWake: '06:00',
      sleepLogs: { '2026-08-01': { bed: '23:45', wake: '07:15', hours: 7.5 } },
    });
    assert.equal(s.version, C.STATE_VERSION);
    assert.equal(s.ageGroup, 'teen');
    assert.equal(s.lastBed, '23:45');          // v2→v3
    assert.equal(s.alarm.sound, 'classic');    // v3→v4
    assert.equal(s.schedule.simple.wake, '06:00');  // v4→v5
    assert.equal(s.schedule.mode, 'simple');
  });

  test('โหมดที่ไม่รู้จักถูกดันกลับเป็น simple', () => {
    assert.equal(C.migrate({ version: 5, schedule: { mode: 'พัง' } }).schedule.mode, 'simple');
  });

  test('ซ่อมชนิดข้อมูลที่ผิดของตาราง', () => {
    const s = C.migrate({ version: 5, schedule: { mode: 'weekly', weekly: 'พัง', overrides: 42, simple: null } });
    assert.deepEqual(s.schedule.weekly, {});
    assert.deepEqual(s.schedule.overrides, {});
    assert.equal(s.schedule.simple.wake, '07:00');
  });

  test('usualWake สะท้อนโหมดง่ายเสมอ เพื่อให้โค้ดเดิมยังทำงาน', () => {
    const s = C.migrate({ version: 5, usualWake: '07:00', schedule: { simple: { wake: '05:45' } } });
    assert.equal(s.usualWake, '05:45');
  });
});
