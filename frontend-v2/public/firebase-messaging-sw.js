/* global firebase */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const params = new URLSearchParams(self.location.search);
const firebaseConfig = {
  apiKey:            params.get('apiKey') || 'AIzaSyAKKfQbTz50I4MwdmwVn47P9hVyPsiIp4U',
  authDomain:        params.get('authDomain') || 'crm-conversacional.firebaseapp.com',
  projectId:         params.get('projectId') || 'crm-conversacional',
  storageBucket:     params.get('storageBucket') || 'crm-conversacional.firebasestorage.app',
  messagingSenderId: params.get('messagingSenderId') || '353322694551',
  appId:             params.get('appId') || '1:353322694551:web:98caaf96ec6130879b76d2',
};

const hasConfig = Object.values(firebaseConfig).every(Boolean);

if (hasConfig) {
  firebase.initializeApp(firebaseConfig);

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || payload.data?.title || 'Meraki CRM';
    const leadId = payload.data?.leadId;
    const targetUrl = payload.data?.url || `/dashboard/inbox${leadId ? `?lead=${leadId}` : ''}`;
    const options = {
      body:  payload.notification?.body || payload.data?.body || 'Tienes un mensaje nuevo.',
      icon:  payload.notification?.icon || '/icon.svg',
      badge: '/icon.svg',
      tag:   leadId || 'inbox',
      renotify: true,
      requireInteraction: false,
      data: {
        url: targetUrl,
        leadId,
        type: payload.data?.type || 'push',
      },
    };

    self.registration.showNotification(title, options);
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/dashboard/inbox', self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => client.url.includes(self.location.origin));
    if (existing) {
      await existing.focus();
      existing.navigate(url);
      return;
    }
    await clients.openWindow(url);
  })());
});
