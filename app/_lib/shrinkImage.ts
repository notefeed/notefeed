// Every picture the web pages upload is at most NOTEFEED_SHRINK_IMAGE_BYTES (1 MiB by default; 0 sends them as they are), which
// the root layout puts on <html>: a photo from a phone's camera is often several MB, over the instance's limit and slow to send.
// A bigger one is drawn again smaller, step by step, until it fits: a PNG or WebP as PNG while that fits (it keeps transparency),
// else as JPEG on white. A GIF is kept as it is (it may move), and so is any file the
// browser can't decode or shrink enough: the server has the last word.
const DEFAULT_MAX = 1024 * 1024;
const configured = () => {
  const raw = typeof document === "undefined" ? undefined : document.documentElement.dataset.shrinkImageBytes;
  return raw === undefined || !Number.isFinite(Number(raw)) ? DEFAULT_MAX : Number(raw);
};
const MAX_EDGE = 2560; // the first try: wider or taller than this is more than any screen shows a note at

export async function shrinkImage(file: File, max = configured()): Promise<File> {
  if (max <= 0 || file.size <= max || file.type === "image/gif") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file); // turned the way the photo's EXIF orientation says
  } catch {
    return file;
  }
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
    const base = file.name.replace(/\.[^.]*$/, "");
    const keepAlpha = file.type === "image/png" || file.type === "image/webp";
    for (let scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height)), i = 0; i < 8; scale *= 0.75, i++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      if (keepAlpha) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const png = await encode("image/png");
        if (png && png.size <= max) return new File([png], `${base}.png`, { type: "image/png" });
      }
      ctx.fillStyle = "#fff"; // JPEG has no transparency: what was see-through shows white, not black
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const jpeg = await encode("image/jpeg");
      if (jpeg && jpeg.size <= max) return new File([jpeg], `${base}.jpg`, { type: "image/jpeg" });
    }
    return file;
  } finally {
    bitmap.close();
  }
}
