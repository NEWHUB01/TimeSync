/* =========================================================
   TimeSync — unit tests สำหรับโปรไฟล์ผู้ใช้
   ========================================================= */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

/* ---------------------------------------------------------
   ageGroupFromAge — อายุ → ช่วงวัยตามชาร์ตเวลานอนสากล
   --------------------------------------------------------- */
describe('ageGroupFromAge', () => {
  test('แต่ละช่วงวัยแมปถูกต้อง', () => {
    assert.equal(C.ageGroupFromAge(0.5), 'infant');
    assert.equal(C.ageGroupFromAge(2), 'toddler');
    assert.equal(C.ageGroupFromAge(4), 'preschool');
    assert.equal(C.ageGroupFromAge(10), 'school');
    assert.equal(C.ageGroupFromAge(16), 'teen');
    assert.equal(C.ageGroupFromAge(22), 'young');
    assert.equal(C.ageGroupFromAge(40), 'adult');
    assert.equal(C.ageGroupFromAge(70), 'senior');
  });

  test('ค่าที่ขอบของแต่ละช่วง', () => {
    assert.equal(C.ageGroupFromAge(1), 'toddler');
    assert.equal(C.ageGroupFromAge(3), 'preschool');
    assert.equal(C.ageGroupFromAge(5), 'preschool');
    assert.equal(C.ageGroupFromAge(6), 'school');
    assert.equal(C.ageGroupFromAge(13), 'school');
    assert.equal(C.ageGroupFromAge(14), 'teen');
    assert.equal(C.ageGroupFromAge(17), 'teen');
    assert.equal(C.ageGroupFromAge(18), 'young');
    assert.equal(C.ageGroupFromAge(25), 'young');
    assert.equal(C.ageGroupFromAge(26), 'adult');
    assert.equal(C.ageGroupFromAge(64), 'adult');
    assert.equal(C.ageGroupFromAge(65), 'senior');
  });

  test('ไม่กรอกหรือค่าไม่ถูกต้อง → null (ไม่เดาแทนผู้ใช้)', () => {
    assert.equal(C.ageGroupFromAge(null), null);
    assert.equal(C.ageGroupFromAge(undefined), null);
    assert.equal(C.ageGroupFromAge(''), null);
    assert.equal(C.ageGroupFromAge('ไม่ใช่ตัวเลข'), null);
    assert.equal(C.ageGroupFromAge(-5), null);
  });

  test('ทุกค่าที่คืนต้องมีอยู่จริงในชาร์ต', () => {
    for (let a = 0; a <= 120; a++) {
      const id = C.ageGroupFromAge(a);
      assert.ok(C.AGE_GROUPS.some(g => g.id === id), `อายุ ${a} คืน id ที่ไม่มีในชาร์ต: ${id}`);
    }
  });

  test('ยิ่งอายุมาก ชั่วโมงนอนที่ต้องการยิ่งไม่เพิ่มขึ้น', () => {
    let prev = Infinity;
    for (let a = 1; a <= 90; a++) {
      const g = C.ageGroupOf(C.ageGroupFromAge(a));
      assert.ok(g.min <= prev, `อายุ ${a} ต้องไม่ต้องการนอนมากกว่าตอนอายุน้อยกว่า`);
      prev = g.min;
    }
  });
});

/* ---------------------------------------------------------
   bmi
   --------------------------------------------------------- */
describe('bmi', () => {
  test('คำนวณถูกต้องและปัดทศนิยม 1 ตำแหน่ง', () => {
    assert.equal(C.bmi(70, 175), 22.9);      // 70 / 1.75² = 22.857
    assert.equal(C.bmi(50, 160), 19.5);
    assert.equal(C.bmi(95, 170), 32.9);
  });

  test('ข้อมูลไม่ครบ → null', () => {
    assert.equal(C.bmi(null, 175), null);
    assert.equal(C.bmi(70, null), null);
    assert.equal(C.bmi(undefined, undefined), null);
    assert.equal(C.bmi('', ''), null);
  });

  test('ค่าที่เป็นไปไม่ได้ → null ไม่ใช่ Infinity หรือ NaN', () => {
    assert.equal(C.bmi(70, 0), null);
    assert.equal(C.bmi(0, 175), null);
    assert.equal(C.bmi(-70, 175), null);
    assert.equal(C.bmi('abc', 175), null);
  });

  test('รับค่าที่เป็นสตริงตัวเลขจากช่อง input ได้', () => {
    assert.equal(C.bmi('70', '175'), 22.9);
  });
});

/* ---------------------------------------------------------
   bmiBand — เกณฑ์ WHO Asia-Pacific
   --------------------------------------------------------- */
describe('bmiBand', () => {
  test('จัดกลุ่มตามเกณฑ์เอเชีย', () => {
    assert.equal(C.bmiBand(17).id, 'under');
    assert.equal(C.bmiBand(21).id, 'normal');
    assert.equal(C.bmiBand(24).id, 'over');
    assert.equal(C.bmiBand(27).id, 'obese1');
    assert.equal(C.bmiBand(35).id, 'obese2');
  });

  test('ค่าที่ขอบพอดี', () => {
    assert.equal(C.bmiBand(18.4).id, 'under');
    assert.equal(C.bmiBand(18.5).id, 'normal');
    assert.equal(C.bmiBand(22.9).id, 'normal');
    assert.equal(C.bmiBand(23).id, 'over');
    assert.equal(C.bmiBand(25).id, 'obese1');
    assert.equal(C.bmiBand(30).id, 'obese2');
  });

  test('ไม่มีค่า → null', () => {
    assert.equal(C.bmiBand(null), null);
    assert.equal(C.bmiBand(undefined), null);
  });

  test('ค่าสูงมากยังจัดกลุ่มได้ ไม่หลุด', () => {
    assert.equal(C.bmiBand(999).id, 'obese2');
    assert.ok(C.bmiBand(0).label);
  });

  test('ทุกกลุ่มมี label และ tone ครบ', () => {
    C.BMI_BANDS.forEach(b => {
      assert.ok(b.id && b.label);
      assert.ok(['good', 'warn', 'bad'].includes(b.tone));
    });
  });
});

/* ---------------------------------------------------------
   genderOf / displayName
   --------------------------------------------------------- */
describe('genderOf / displayName', () => {
  test('เพศที่รู้จัก', () => {
    assert.equal(C.genderOf('female').label, 'หญิง');
    assert.equal(C.genderOf('male').label, 'ชาย');
    assert.equal(C.genderOf('other').label, 'อื่น ๆ');
  });

  test('ไม่ระบุหรือค่าแปลก → null', () => {
    assert.equal(C.genderOf(''), null);
    assert.equal(C.genderOf('ไม่มีจริง'), null);
    assert.equal(C.genderOf(undefined), null);
  });

  test('displayName ตัดช่องว่างและคืนค่าว่างเมื่อไม่ได้กรอก', () => {
    assert.equal(C.displayName({ profile: { name: '  มายด์  ' } }), 'มายด์');
    assert.equal(C.displayName({ profile: { name: '   ' } }), '');
    assert.equal(C.displayName({ profile: {} }), '');
    assert.equal(C.displayName({}), '');
  });
});

/* ---------------------------------------------------------
   numOrNull
   --------------------------------------------------------- */
describe('numOrNull', () => {
  test('ช่องว่างคืน null ไม่ใช่ 0', () => {
    assert.equal(C.numOrNull('', 0, 100), null);
    assert.equal(C.numOrNull(null, 0, 100), null);
    assert.equal(C.numOrNull(undefined, 0, 100), null);
  });

  test('ตัดให้อยู่ในช่วงที่กำหนด', () => {
    assert.equal(C.numOrNull(500, 30, 260), 260);
    assert.equal(C.numOrNull(-10, 30, 260), 30);
    assert.equal(C.numOrNull(175, 30, 260), 175);
  });

  test('ปัดทศนิยม 1 ตำแหน่ง', () => {
    assert.equal(C.numOrNull(70.46, 2, 400), 70.5);
  });

  test('0 ที่กรอกจริงต้องไม่ถูกมองว่าว่าง', () => {
    assert.equal(C.numOrNull(0, 0, 120), 0);
    assert.equal(C.numOrNull('0', 0, 120), 0);
  });
});

/* ---------------------------------------------------------
   migrate v5 → v6
   --------------------------------------------------------- */
describe('migrate v5 → v6', () => {
  test('ผู้ใช้เดิมได้โปรไฟล์ว่าง ไม่ถูกบังคับกรอก', () => {
    const s = C.migrate({ version: 5, ageGroup: 'adult' });
    assert.equal(s.version, C.STATE_VERSION);
    assert.equal(s.profile.name, '');
    assert.equal(s.profile.age, null);
    assert.equal(s.profile.height, null);
    assert.equal(s.profile.weight, null);
    assert.equal(s.profile.gender, '');
    assert.equal(s.ageGroup, 'adult');       // ค่าที่ตั้งเองไว้ไม่ถูกทับ
  });

  test('อัปเกรดข้ามจาก v1 ถึงเวอร์ชันล่าสุดได้ครบทุกชั้น', () => {
    const s = C.migrate({
      ageGroup: 'teen', usualWake: '06:00',
      sleepLogs: { '2026-08-01': { bed: '23:45', wake: '07:15', hours: 7.5 } },
    });
    assert.equal(s.version, C.STATE_VERSION);
    assert.equal(s.lastBed, '23:45');            // v2→v3
    assert.equal(s.alarm.sound, 'classic');      // v3→v4
    assert.equal(s.schedule.simple.wake, '06:00');  // v4→v5
    assert.deepEqual(s.profile, C.defaults().profile);  // v5→v6
  });

  test('เก็บค่าที่ผู้ใช้กรอกไว้ครบ', () => {
    const s = C.migrate({
      version: 6,
      profile: { name: 'มายด์', age: 24, height: 165, weight: 55, gender: 'female' },
    });
    assert.equal(s.profile.name, 'มายด์');
    assert.equal(s.profile.age, 24);
    assert.equal(s.profile.height, 165);
    assert.equal(s.profile.weight, 55);
    assert.equal(s.profile.gender, 'female');
  });

  test('ซ่อมค่าที่อยู่นอกช่วงที่เป็นไปได้', () => {
    const s = C.migrate({
      version: 6,
      profile: { age: 500, height: 5, weight: 9999, gender: 'ไม่มีจริง', name: 'ก'.repeat(200) },
    });
    assert.equal(s.profile.age, 120);
    assert.equal(s.profile.height, 30);
    assert.equal(s.profile.weight, 400);
    assert.equal(s.profile.gender, '');
    assert.equal(s.profile.name.length, 40);
  });

  test('ซ่อมชนิดข้อมูลที่ผิด', () => {
    const s = C.migrate({ version: 6, profile: 'พัง' });
    assert.equal(s.profile.name, '');
    assert.equal(s.profile.age, null);
  });

  test('profile ที่กรอกไม่ครบ ใช้ต่อได้โดยไม่พัง', () => {
    const s = C.migrate({ version: 6, profile: { name: 'เอ' } });
    assert.equal(s.profile.name, 'เอ');
    assert.equal(C.bmi(s.profile.weight, s.profile.height), null);
    assert.equal(C.ageGroupFromAge(s.profile.age), null);
  });
});
