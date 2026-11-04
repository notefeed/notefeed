// The pictures another app shared to notefeed, kept in the browser by the service worker (public/sw.js writes this cache: each
// picture under /shared/<index>, its type in Content-Type and its file name in X-Name). They stay there until the note is
// posted (clearSharedFiles) or another share replaces them, so going back to pick another feed, or a reload, still finds them.
// Nothing there, no Cache API or anything failing is no pictures.
const CACHE = "notefeed-share";

export async function readSharedFiles(): Promise<File[]> {
  try {
    if (typeof caches === "undefined" || !(await caches.has(CACHE))) return [];
    const cache = await caches.open(CACHE);
    const keys = [...(await cache.keys())].sort((a, b) => index(a) - index(b));
    const files = await Promise.all(
      keys.map(async (key) => {
        const res = await cache.match(key);
        if (!res) return null;
        const type = res.headers.get("Content-Type") ?? "";
        return new File([await res.blob()], decodeURIComponent(res.headers.get("X-Name") ?? "") || "shared", { type });
      }),
    );
    return files.filter((f): f is File => f !== null);
  } catch {
    return [];
  }
}

const index = (req: Request) => Number(new URL(req.url).pathname.split("/").pop());

export async function clearSharedFiles(): Promise<void> {
  await caches?.delete(CACHE).catch(() => false);
}
