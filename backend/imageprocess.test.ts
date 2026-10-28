import { crc32, deflateSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { BusyError, ImageTooLargeError, UnsupportedTypeError } from "./errors";
import { loadSharp, MAX_EDGE, processImage, sharpBuild } from "./imageprocess";
import { GIF, JPG, PNG, WEBP } from "./testimages";

const sharp = loadSharp();
const meta = (b: Uint8Array) => sharp(Buffer.from(b), { animated: true }).metadata();
const solid = (width: number, height: number, alpha = 1) => sharp({ create: { width, height, channels: 4, background: { r: 40, g: 90, b: 160, alpha } } });
const frames = () => Promise.all(["#f00", "#0f0", "#00f"].map((c) => sharp({ create: { width: 40, height: 30, channels: 4, background: c } }).png().toBuffer()));

test("sharp runs as WebAssembly, the build production ships, not native libvips", () => {
  expect(sharpBuild()).toBe("wasm");
});

describe("processImage", () => {
  test("a phone photo comes out upright, at most 2560 px, without EXIF or GPS", async () => {
    const photo = await solid(3000, 2000).withMetadata({ orientation: 6 }).withExif({ IFD0: { Make: "Phone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 8/1 0/1" } }).jpeg().toBuffer();
    expect((await meta(photo)).exif).toBeDefined();
    const m = await meta(await processImage(new Uint8Array(photo), "jpg"));
    expect([m.format, m.width, m.height]).toEqual(["jpeg", 1707, MAX_EDGE]); // turned: 2000 × 3000, scaled to fit 2560
    expect([m.exif, m.xmp, m.iptc, m.icc, m.orientation]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  test("a small image keeps its size", async () => {
    const m = await meta(await processImage(new Uint8Array(await solid(300, 200).jpeg().toBuffer()), "jpg"));
    expect([m.width, m.height]).toEqual([300, 200]);
  });

  test("a PNG stays a PNG and keeps its transparency", async () => {
    const m = await meta(await processImage(new Uint8Array(await solid(3000, 100, 0.5).png().toBuffer()), "png"));
    expect([m.format, m.width, m.height, m.hasAlpha]).toEqual(["png", MAX_EDGE, 85, true]);
  });

  test.each(["gif", "webp"] as const)("an animated %s keeps its frames, delays and loop", async (ext) => {
    const anim = await sharp(await frames(), { join: { animated: true } })[ext]({ delay: [100, 200, 300], loop: 0 }).toBuffer();
    const m = await meta(await processImage(new Uint8Array(anim), ext));
    expect([m.format, m.pages, m.delay, m.loop, m.pageHeight]).toEqual([ext, 3, [100, 200, 300], 0, 30]);
  });

  test.each([["png", PNG], ["jpg", JPG], ["gif", GIF], ["webp", WEBP]] as const)("the %s fixture is processed in its own format", async (ext, bytes) => {
    expect((await meta(await processImage(bytes, ext))).format).toBe(ext === "jpg" ? "jpeg" : ext);
  });

  test("the same image gives the same bytes", async () => {
    expect(Buffer.from(await processImage(JPG, "jpg")).equals(Buffer.from(await processImage(JPG, "jpg")))).toBe(true);
  });

  test("a header followed by something else is refused", async () => {
    const polyglot = new Uint8Array([...PNG.slice(0, 16), ...new TextEncoder().encode("<html><script>alert(1)</script>")]);
    await expect(processImage(polyglot, "png")).rejects.toThrow(new UnsupportedTypeError("the body is not a valid image/png"));
  });

  test("a format notefeed doesn't take is not decoded, even under another name", async () => {
    const tiff = new Uint8Array(await solid(10, 10).tiff().toBuffer());
    await expect(processImage(tiff, "png")).rejects.toBeInstanceOf(UnsupportedTypeError);
  });

  test("bytes of another format than the header said are refused", async () => {
    await expect(processImage(PNG, "jpg")).rejects.toBeInstanceOf(UnsupportedTypeError);
  });

  test("more than 100 megapixels is refused before it is decoded", async () => {
    // A PNG whose header declares 20000 × 20000 (400 MP), and next to no pixels: refused from the header alone.
    const chunk = (type: string, data: Buffer) => {
      const body = Buffer.concat([Buffer.from(type), data]);
      const [length, crc] = [Buffer.alloc(4), Buffer.alloc(4)];
      length.writeUInt32BE(data.length);
      crc.writeUInt32BE(crc32(body));
      return Buffer.concat([length, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(20000, 0);
    ihdr.writeUInt32BE(20000, 4);
    ihdr.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
    const huge = new Uint8Array(Buffer.concat([PNG.slice(0, 8), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.alloc(100))), chunk("IEND", Buffer.alloc(0))]));
    await expect(processImage(huge, "png")).rejects.toThrow(new ImageTooLargeError("image exceeds 100 megapixels"));
  });

  test("two run at a time, eight wait, and the next is refused as busy", async () => {
    const big = new Uint8Array(await solid(4000, 3000).jpeg().toBuffer());
    const all = Array.from({ length: 11 }, () => processImage(big, "jpg").then(() => "done", (e: unknown) => e));
    const results = await Promise.all(all);
    expect(results.filter((r) => r === "done")).toHaveLength(10);
    expect(results.filter((r) => r instanceof BusyError)).toHaveLength(1);
    expect(await processImage(big, "jpg")).toBeInstanceOf(Uint8Array); // the queue is free again
  }, 60_000);
});
