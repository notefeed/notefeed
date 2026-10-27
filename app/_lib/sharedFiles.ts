// The pictures another app shared to notefeed, kept in the browser by the service worker (public/sw.js writes this cache: each
// picture under /shared/<index>, its type in Content-Type and its file name in X-Name). Taking them empties the cache, so they
// are attached once. Nothing there, no Cache API or anything failing is no pictures.
const CACHE = "notefeed-share";

export async function takeSharedFiles(): Promise<File[]> {
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
    await caches.delete(CACHE);
    return files.filter((f): f is File => f !== null);
  } catch {
    return [];
  }
}

const index = (req: Request) => Number(new URL(req.url).pathname.split("/").pop());
