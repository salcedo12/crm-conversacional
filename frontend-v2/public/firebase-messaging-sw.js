/* global firebase */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const params = new URLSearchParams(self.location.search);
const firebaseConfig = {
  apiKey:            params.get('apiKey'),
  authDomain:        params.get('authDomain'),
  projectId:         params.get('projectId'),
  storageBucket:     params.get('storageBucket'),
  messagingSenderId: params.get('messagingSenderId'),
  appId:             params.get('appId'),
};

const hasConfig = Object.values(firebaseConfig).every(Boolean);

if (hasConfig) {
  firebase.initializeApp(firebaseConfig);

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const title = payload.data?.title || 'Nuevo mensaje';
    const options = {
      body:  payload.data?.body || 'Tienes una conversacion pendiente.',
      icon:  '/icon.svg',
      badge: '/icon.svg',
      tag:   payload.data?.leadId || 'inbox',
      data: {
        url: payload.data?.url || `/dashboard/inbox${payload.data?.leadId ? `?lead=${payload.data.leadId}` : ''}`,
      },
    };

    self.registration.showNotification(title, options);
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/dashboard/inbox';

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
