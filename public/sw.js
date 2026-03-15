self.addEventListener("push", (event) => {
  let payload = { title: "Uj feliratkozas", body: "" };
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (err) {
      payload.body = event.data.text();
    }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "Uj feliratkozas", {
      body: payload.body || "Erkezett egy uj feliratkozas.",
      badge: "/favicon.ico",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientsArr) => {
        for (const client of clientsArr) {
          if (client.url.includes("/")) {
            return client.focus();
          }
        }
        return self.clients.openWindow("/");
      }),
  );
});
