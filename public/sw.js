// notefeed's service worker (ADR 0048). Its one job: the installed app's share target (app/manifest.ts) POSTs what another app
// shared to /api/share, which no server route answers. This takes it, keeps the pictures in the browser and goes on to the start
// page, which asks for the feed; that feed's compose box takes them (app/_lib/sharedFiles.ts reads the same cache). Nothing else
// passes through here: no caching of pages, no offline mode. Every other request goes to the network as if this weren't installed.
const CACHE = "notefeed-share";
const PICTURES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.origin !== self.location.origin || url.pathname !== "/api/share") return;
  event.respondWith(receive(event.request));
});

async function receive(request) {
  const form = await request.formData();
  const pictures = form.getAll("files").filter((f) => typeof f !== "string" && PICTURES.includes(f.type));
  await caches.delete(CACHE); // a new share replaces one that was never posted
  if (pictures.length) {
    const cache = await caches.open(CACHE);
    await Promise.all(
      pictures.map((f, i) =>
        cache.put(`/shared/${i}`, new Response(f, { headers: { "Content-Type": f.type, "X-Name": encodeURIComponent(f.name) } })),
      ),
    );
  }
  const query = new URLSearchParams();
  for (const name of ["share_title", "share_text", "share_url"]) {
    const value = form.get(name);
    if (typeof value === "string" && value !== "") query.set(name, value);
  }
  if (pictures.length) query.set("shared", "1");
  const search = query.size ? `?${query}` : "";
  return Response.redirect(new URL(`/${search}`, self.location.origin).href, 303);
}
