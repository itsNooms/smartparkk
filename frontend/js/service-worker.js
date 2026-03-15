// Service Worker for Push Notifications with Custom Sound and Popup
const CACHE_NAME = 'smartparkk-v1';

// Install event - cache resources
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installing...');
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Activating...');
    event.waitUntil(clients.claim());
});

// Push notification event - show notification with custom sound and popup
self.addEventListener('push', (event) => {
    console.log('[Service Worker] Push received');
    
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { title: 'New Notification', body: 'You have a new visitor request' };
    }

    const options = {
        body: data.body || 'You have a new visitor request',
        icon: data.icon || '/logo.png',
        badge: data.badge || '/logo.png',
        vibrate: data.vibrate || [100, 50, 100, 50, 200],
        tag: data.tag || 'smartparkk-visitor',
        renotify: data.renotify !== false,
        requireInteraction: data.requireInteraction !== false,
        actions: data.actions || [
            { action: 'approve', title: '✓ Approve' },
            { action: 'reject', title: '✗ Reject' }
        ],
        data: data.data || {
            url: '/resident',
            requestId: data.requestId
        }
    };

    // Show notification
    event.waitUntil(
        self.registration.showNotification(data.title || 'New Visitor Request', options)
    );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
    console.log('[Service Worker] Notification clicked:', event.action);
    
    event.notification.close();
    
    const url = event.notification.data.url || '/resident';
    
    // Handle action buttons
    if (event.action === 'approve' || event.action === 'reject') {
        // You could send an API call here to approve/reject
        event.waitUntil(
            clients.openWindow(url)
        );
    } else {
        // Default click - open the app
        event.waitUntil(
            clients.matchAll({ type: 'window' }).then((windowClients) => {
                // Check if there's already a window/tab open
                for (let client of windowClients) {
                    if (client.url.includes(url) && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Open new tab if no window found
                if (clients.openWindow) {
                    return clients.openWindow(url);
                }
            })
        );
    }
});

// Notification close event
self.addEventListener('notificationclose', (event) => {
    console.log('[Service Worker] Notification closed');
});