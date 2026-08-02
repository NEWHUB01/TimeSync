/* =========================================================
   TimeSync — service worker
   Phase 1: ใช้แสดง notification ให้ค้างอยู่ใน tray ของระบบ
            และให้คลิกแล้วโฟกัสกลับมาที่หน้าแอปได้
   (การ cache แบบออฟไลน์จะเพิ่มใน Phase 4)
   ========================================================= */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

/** หน้าแอปส่งคำสั่งมาให้ SW แสดง notification */
self.addEventListener('message', event => {
  const msg = event.data || {};
  if (msg.type !== 'notify') return;

  event.waitUntil(
    self.registration.showNotification(msg.title || 'TimeSync', {
      body: msg.body || '',
      tag: msg.tag || 'timesync',
      renotify: true,
      requireInteraction: !!msg.sticky,
      silent: false,
      data: { tab: msg.tab || null, url: msg.url || './' },
    })
  );
});

/** คลิกที่ notification → โฟกัสแท็บเดิมถ้ามี ไม่งั้นเปิดใหม่ */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const tab = event.notification.data && event.notification.data.tab;

  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) {
      if (client.url.includes(self.registration.scope)) {
        await client.focus();
        if (tab) client.postMessage({ type: 'openTab', tab });
        return;
      }
    }
    await self.clients.openWindow(tab ? `./?tab=${encodeURIComponent(tab)}` : './');
  })());
});
