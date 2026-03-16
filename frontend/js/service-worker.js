// Service Worker for Push Notifications with Custom Sound and Popup
const CACHE_NAME = 'smartparkk-v1';
const SOUND_FILE = '/sounds/Car Horn Beeps.mp3';

// Install event - cache resources
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll([
                '/',
                '/index.html',
                '/resident.html',
                '/admin.html',
                '/logo.png',
                '/manifest.json',
                SOUND_FILE
            ]).catch(err => {
                console.warn('[Service Worker] Cache failed (some files may not exist):', err);
                // Continue even if some files fail to cache
                return Promise.resolve();
            });
        })
    );
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
        console.warn('[Service Worker] Failed to parse push data:', e);
        data = { 
            title: 'New Notification', 
            body: 'You have a new visitor request',
            requestId: null
        };
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
        data: {
            url: data.url || '/resident',
            requestId: data.requestId,
            playSound: true  // Flag to trigger sound from client
        }
    };

    // Try to add sound (iOS may not support this, but Android will)
    // Use 'sound' property if available (some browsers support it)
    if (data.sound) {
        options.sound = data.sound;
    }

    console.log('[Service Worker] Showing notification with options:', options);

    // Show notification
    event.waitUntil(
        self.registration.showNotification(
            data.title || 'New Visitor Request', 
            options
        ).then(() => {
            console.log('[Service Worker] Notification shown successfully');
            
            // Send message to all clients to play sound on their end
            // This is more reliable than relying on service worker sound
            self.clients.matchAll().then(clients => {
                clients.forEach(client => {
                    client.postMessage({
                        type: 'PLAY_NOTIFICATION_SOUND',
                        sound: data.sound || SOUND_FILE
                    });
                });
            });
        }).catch(err => {
            console.error('[Service Worker] Failed to show notification:', err);
        })
    );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
    console.log('[Service Worker] Notification clicked:', event.action);
    
    event.notification.close();
    
    const url = event.notification.data.url || '/resident';
    const requestId = event.notification.data.requestId;
    
    // Handle action buttons
    if (event.action === 'approve' || event.action === 'reject') {
        event.waitUntil(
            clients.openWindow(url + `?action=${event.action}&requestId=${requestId}`)
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
