// Real images for tests, 2 × 2 pixels: every stored image is decoded first (imageprocess.ts), so a header followed by junk is refused.
import { crc32, deflateSync } from "node:zlib";
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

export const PNG = b64("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWMwXpVmvCqNAUIBACKWBQ1W9VvXAAAAAElFTkSuQmCC");
export const JPG = b64(
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCAD0C//9k=",
);
export const GIF = b64("R0lGODlhAgACAIAAAExpcTOqZiH5BAUAAAAALAAAAAACAAIAAAICjFMAOw==");
export const WEBP = b64("UklGRjYAAABXRUJQVlA4ICoAAACwAQCdASoCAAIAAUAmJaACdLoABKoAAP4THXeLSjX/00j/jSP+NI+U0AA=");

// A real 2 × 2 PNG of its own for each `n` (0 to 16777215): its colour is n, so it stays different from the others once stored.
export function png(n = 1): Uint8Array<ArrayBuffer> {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const [length, crc] = [Buffer.alloc(4), Buffer.alloc(4)];
    length.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0]); // 2 × 2, 8 bits, RGB
  const rgb = [n >> 16, (n >> 8) & 255, n & 255].map((v) => v & 255);
  const row = [0, ...rgb, ...rgb]; // filter byte, two pixels
  return Uint8Array.from(Buffer.concat([PNG.subarray(0, 8), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([...row, ...row]))), chunk("IEND", Buffer.alloc(0))]));
}
