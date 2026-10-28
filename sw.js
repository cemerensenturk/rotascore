// Ana ekrana eklenen uygulama için servis çalışanı.
// "Önce internet": her istek her zaman sunucudan alınır, kopya sadece internet yokken kullanılır.
// Böylece yeni bir sürüm yüklendiğinde eski dosyalar takılı kalmaz.
const CACHE = "rotascore-offline";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", event => {
    const request = event.request;
    // Sadece sitenin kendi dosyaları (günün maçları GitHub'dan geliyor, ona dokunmuyoruz)
    if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

    event.respondWith(
        fetch(request)
            .then(response => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE).then(cache => cache.put(request, copy));
                }
                return response;
            })
            .catch(() => caches.match(request, { ignoreSearch: true }))
    );
});
