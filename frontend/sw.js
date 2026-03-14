self.addEventListener('push', function (event) {
    if (event.data) {
        const payload = event.data.json();

        const options = {
            body: payload.body,
            icon: 'https://cdn-icons-png.flaticon.com/512/3063/3063822.png',
            badge: 'https://cdn-icons-png.flaticon.com/512/3063/3063822.png',
            vibrate: [200, 100, 200, 100, 200, 100, 200],
            data: payload.data || {},
            actions: payload.actions || []
        };

        event.waitUntil(
            self.registration.showNotification(payload.title, options)
        );
    }
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
            if (clientList.length > 0) {
                let client = clientList[0];
                for (let i = 0; i < clientList.length; i++) {
                    if (clientList[i].focused) {
                        client = clientList[i];
                    }
                }
                return client.focus();
            }
            return clients.openWindow('/resident.html');
        })
    );
});
