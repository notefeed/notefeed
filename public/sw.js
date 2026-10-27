// notefeed's service worker (ADR 0048). Its one job: the installed app's share target (app/manifest.ts) POSTs what another app
// shared to /api/share, which no server route answers. This takes it, keeps the pictures in the browser and goes on to the start
// page, which asks for the feed; that feed's compose box takes them (app/_lib/sharedFiles.ts reads the same cache). Nothing else
// passes through here: no caching of pages, no offline mode. Every other request goes to the network as if this weren't installed.
const CACHE = "notefeed-share";
const PICTURES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const KEEP = 11; // a note takes 10 (MAX_ATTACHMENTS in shared/links.ts); one more lets the compose box say the rest were left out

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.origin !== self.location.origin || url.pathname !== "/api/share") return;
  event.respondWith(receive(event.request));
});

// Whatever goes wrong (a body the browser can't read, storage full), the person lands on the start page, with the text
// if it could be read: a share is never answered with an error page.
async function receive(request) {
  const query = new URLSearchParams();
  try {
    const form = await request.formData();
    for (const name of ["share_title", "share_text", "share_url"]) {
      const value = form.get(name);
      if (typeof value === "string" && value !== "") query.set(name, value);
    }
    const pictures = form.getAll("files").filter((f) => typeof f !== "string" && PICTURES.includes(f.type)).slice(0, KEEP);
    await caches.delete(CACHE); // a new share replaces one that was never posted
    if (pictures.length) {
      const cache = await caches.open(CACHE);
      await Promise.all(
        pictures.map((f, i) =>
          cache.put(`/shared/${i}`, new Response(f, { headers: { "Content-Type": f.type, "X-Name": encodeURIComponent(f.name) } })),
        ),
      );
      query.set("shared", "1");
    }
  } catch {
    await caches.delete(CACHE).catch(() => {}); // no half-stored share
  }
  const search = query.size ? `?${query}` : "";
  return Response.redirect(new URL(`/${search}`, self.location.origin).href, 303);
}
