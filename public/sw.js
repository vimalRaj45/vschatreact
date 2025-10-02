/* eslint-disable no-undef */
/* eslint-disable no-restricted-globals */
// public/sw.js

self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activated');
  return self.clients.claim();
});

// Listen to push events
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    data = event.data.json();
  }

  const options = {
    body: data.body || 'You have a new message',
    icon: '/icon-192x192.png',
    badge: '/icon-72x72.png',
    data: data
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Chat App', options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});

// Optional: Cache static assets (simple PWA offline support)
self.addEventListener('fetch', (event) => {
  // Here you can implement caching strategies if needed
});
