// Every image is decoded and encoded again before it is stored (issue #312, ADR 0049): turned the way its EXIF says, at most
// 2560 px on its long side, in the format it came in, without metadata (EXIF, GPS, XMP, comments). One algorithm for every
// client, so the web pages shrink nothing themselves.
//
// sharp runs as WebAssembly (@img/sharp-wasm32), never as native libvips: a decoder bug in an uploaded file stays in the
// module's own memory. The native packages are left out of the standalone build (next.config.ts); here, where node_modules
// has them too (dev, tests), loading them is refused, so every run uses the same build as production.
import { createRequire } from "node:module";
import Module from "node:module";
import type { ImageType } from "../shared/images";
import { BusyError, ImageTooLargeError, UnsupportedTypeError } from "./errors";

type Sharp = typeof import("sharp").default;

export const MAX_EDGE = 2560;
export const MAX_PIXELS = 100_000_000; // a 48–50 MP phone photo fits; counts every frame of an animated image
const TIMEOUT_SECONDS = 10;
const RUNNING = 2; // images processed at the same time
const WAITING = 8; // more than this waiting: 503 busy

const NATIVE = /^@img\/sharp-(?!wasm32)[^/]+\/sharp\.node$|\/build\/Release\/sharp-(?!wasm32)/;

let loaded: Sharp | undefined;
/** sharp, as WebAssembly, ready to use. Tests make their images with it. */
export function loadSharp(): Sharp {
  if (loaded) return loaded;
  const resolver = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
  const resolve = resolver._resolveFilename;
  resolver._resolveFilename = function (request, ...rest) {
    if (NATIVE.test(request)) throw Object.assign(new Error(`${request} is not used: notefeed runs sharp as WebAssembly`), { code: "MODULE_NOT_FOUND" });
    return resolve.call(this, request, ...rest);
  };
  try {
    loaded = createRequire(import.meta.url)("sharp") as Sharp;
  } finally {
    resolver._resolveFilename = resolve;
  }
  // Only the four formats notefeed takes may be decoded: libvips has loaders for many more (TIFF, SVG, PDF, ...).
  loaded.block({ operation: ["VipsForeignLoad"] });
  loaded.unblock({ operation: ["VipsForeignLoadJpegBuffer", "VipsForeignLoadPngBuffer", "VipsForeignLoadNsgifBuffer", "VipsForeignLoadWebpBuffer"] });
  loaded.cache(false); // every image is new: nothing to gain, memory to keep
  loaded.concurrency(1);
  return loaded;
}

/** Which sharp build runs: "wasm" is the only one notefeed means to. */
export const sharpBuild = (): "wasm" | "native" => (loadSharp().versions as { emscripten?: string }).emscripten ? "wasm" : "native";

// At most RUNNING at a time; a request that would be the WAITING+1st in line is refused at once.
let running = 0;
const queue: (() => void)[] = [];
async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= RUNNING) {
    if (queue.length >= WAITING) throw new BusyError();
    await new Promise<void>((go) => queue.push(go));
  } else running++;
  try {
    return await work();
  } finally {
    const next = queue.shift();
    if (next) next();
    else running--;
  }
}

const MEDIA: Record<ImageType, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const FORMAT: Record<string, ImageType> = { jpeg: "jpg", png: "png", gif: "gif", webp: "webp" };

/** The image as it will be stored. `ext` is its format as the first bytes say (sniffImage); the result is in the same format. */
export async function processImage(body: Uint8Array, ext: ImageType): Promise<Uint8Array> {
  return slot(async () => {
    const s = loadSharp();
    const animated = ext === "gif" || ext === "webp";
    try {
      const input = () => s(body, { limitInputPixels: MAX_PIXELS, animated, failOn: "error" });
      const meta = await input().metadata();
      if (FORMAT[meta.format ?? ""] !== ext) throw new UnsupportedTypeError(`the body is not a valid ${MEDIA[ext]}`);
      const image = input().timeout({ seconds: TIMEOUT_SECONDS }).rotate().resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true });
      const out =
        ext === "jpg" ? image.jpeg({ quality: 85 })
        : ext === "png" ? image.png({ palette: meta.isPalette === true })
        : ext === "webp" ? image.webp({ quality: 85 })
        : image.gif();
      return new Uint8Array(await out.toBuffer());
    } catch (e) {
      if (e instanceof UnsupportedTypeError) throw e;
      const message = e instanceof Error ? e.message : "";
      if (/pixel limit/i.test(message)) throw new ImageTooLargeError(`image exceeds ${MAX_PIXELS / 1_000_000} megapixels`);
      if (/timeout/i.test(message)) throw new ImageTooLargeError("image takes too long to process");
      throw new UnsupportedTypeError(`the body is not a valid ${MEDIA[ext]}`);
    }
  });
}
