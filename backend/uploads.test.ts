import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { API_PREFIX, dispatch } from "./http/api";
import { resetFeedsForTests } from "./feeds";
import { resetRateLimitsForTests } from "./limits";
import { createUpload } from "./posting";
import { PNG } from "./testimages";
import { MAX_UPLOADS, MAX_UPLOADS_PER_FEED, UPLOAD_TTL_MS, makeUpload, receiveUpload, resetUploads, withUploads } from "./uploads";

beforeEach(() => {
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  resetFeedsForTests();
  resetRateLimitsForTests();
  resetUploads();
  for (const k of ["NOTEFEED_PASSWORD", "NOTEFEED_RATE_LIMIT", "NOTEFEED_MAX_IMAGE_BYTES"]) delete process.env[k];
});

const PNG_TYPE = { mediaType: "image/png", isImage: true };
const bytes = (b: Uint8Array) => async (max: number) => (b.length > max ? null : b);
const put = (token: string, body: BodyInit, headers: Record<string, string> = {}) =>
  dispatch(new Request(`http://localhost:3000${API_PREFIX}/uploads/${token}`, { method: "PUT", body, headers: { host: "localhost:3000", ...headers } }), [
    "uploads",
    token,
  ]);
const uploadsDir = () => join(process.env.DATA_DIR!, "uploads");

describe("an upload", () => {
  test("takes one file, which a post reads once; the files on disk are named by id, never by token", async () => {
    const u = await makeUpload("f", PNG_TYPE);
    expect(await receiveUpload(u.token, bytes(PNG))).toEqual({ size: PNG.length, mediaType: "image/png" });
    await expect(receiveUpload(u.token, bytes(PNG))).rejects.toThrow(/already has its file/);
    expect(await readdir(uploadsDir())).toEqual([u.id]);
    const got = await withUploads("f", [u.id], async ([f]) => f);
    expect(Buffer.from(got.body).equals(Buffer.from(PNG))).toBe(true);
    expect(await readdir(uploadsDir())).toEqual([]);
    await expect(withUploads("f", [u.id], async () => 1)).rejects.toThrow(/no such upload/);
  });

  test("expires after 15 minutes, file and all", async () => {
    const now = Date.now();
    const u = await makeUpload("f", PNG_TYPE, undefined, now);
    await receiveUpload(u.token, bytes(PNG), now);
    expect(u.expires.getTime()).toBe(now + UPLOAD_TTL_MS);
    await expect(withUploads("f", [u.id], async () => 1, now + UPLOAD_TTL_MS)).rejects.toThrow(/no such upload/);
    const late = await makeUpload("f", PNG_TYPE, undefined, now);
    await expect(receiveUpload(late.token, bytes(PNG), now + UPLOAD_TTL_MS)).rejects.toThrow(/no such upload/);
    expect(await readdir(uploadsDir())).toEqual([]);
  });

  test("a refused file may be sent again: too large, empty, the wrong size or not its type", async () => {
    vi.stubEnv("NOTEFEED_MAX_IMAGE_BYTES", String(PNG.length));
    const u = await makeUpload("f", PNG_TYPE, PNG.length);
    await expect(receiveUpload(u.token, bytes(new Uint8Array([...PNG, 0])))).rejects.toThrow(/size limit/);
    await expect(receiveUpload(u.token, bytes(new Uint8Array()))).rejects.toThrow(/empty/);
    await expect(receiveUpload(u.token, bytes(PNG.slice(0, 10)))).rejects.toThrow(/made for \d+ bytes/);
    const v = await makeUpload("f", PNG_TYPE);
    await expect(receiveUpload(v.token, bytes(new TextEncoder().encode("not a png")))).rejects.toThrow(/not image\/png/);
    expect((await receiveUpload(u.token, bytes(PNG))).size).toBe(PNG.length);
  });

  test("a size over the limit is refused when the upload is made", async () => {
    vi.stubEnv("NOTEFEED_MAX_IMAGE_BYTES", "100");
    await expect(makeUpload("f", PNG_TYPE, 101)).rejects.toThrow();
    await expect(makeUpload("f", PNG_TYPE, 0)).rejects.toThrow(/at least 1/);
  });

  test(`at most ${MAX_UPLOADS_PER_FEED} wait for one feed and ${MAX_UPLOADS} in all`, async () => {
    for (let i = 0; i < MAX_UPLOADS_PER_FEED; i++) await makeUpload("f", PNG_TYPE);
    await expect(makeUpload("f", PNG_TYPE)).rejects.toThrow(/too many uploads waiting/);
    for (let i = MAX_UPLOADS_PER_FEED; i < MAX_UPLOADS; i++) await makeUpload(`g${i % 5}`, PNG_TYPE);
    await expect(makeUpload("h", PNG_TYPE)).rejects.toThrow(/too many uploads waiting/);
  });

  test("a post that fails leaves it, and two posts can't take it at once", async () => {
    const u = await makeUpload("f", PNG_TYPE);
    await receiveUpload(u.token, bytes(PNG));
    await expect(withUploads("f", [u.id], async () => Promise.reject(new Error("refused")))).rejects.toThrow("refused");
    let release!: () => void;
    const first = withUploads("f", [u.id], () => new Promise<void>((r) => (release = r)));
    await vi.waitFor(() => expect(release).toBeDefined());
    await expect(withUploads("f", [u.id], async () => 1)).rejects.toThrow(/being posted/);
    release();
    await first;
    await expect(withUploads("f", [u.id, u.id], async () => 1)).rejects.toThrow(/given twice/);
  });

  test("what is on disk from before a restart is cleared by the first upload", async () => {
    await mkdir(uploadsDir(), { recursive: true });
    await writeFile(join(uploadsDir(), "left-over"), "x");
    await makeUpload("f", PNG_TYPE);
    expect(await readdir(uploadsDir())).toEqual([]);
  });

  test("createUpload needs a protected feed's password, like a post", async () => {
    await expect(createUpload("f", "ip", {}, "image/svg+xml")).rejects.toThrow();
    expect((await createUpload("f", "ip", {}, "text/markdown")).maxBytes).toBe(102400);
  });
});

describe("PUT /uploads/{token}", () => {
  test("200 with the size; needs no instance password; an unknown token is 404, a second PUT 400, a wrong file 415", async () => {
    process.env.NOTEFEED_PASSWORD = "instance-pw";
    const u = await makeUpload("f", PNG_TYPE);
    const ok = await put(u.token, Buffer.from(PNG));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ size: PNG.length, type: "image/png" });
    expect((await put(u.token, Buffer.from(PNG))).status).toBe(400);
    expect((await put("nope", Buffer.from(PNG))).status).toBe(404);
    const v = await makeUpload("f", PNG_TYPE);
    expect((await put(v.token, "plain text")).status).toBe(415);
  });
  test("413 over the limit", async () => {
    vi.stubEnv("NOTEFEED_MAX_IMAGE_BYTES", "10");
    const u = await makeUpload("f", PNG_TYPE);
    expect((await put(u.token, Buffer.from(PNG))).status).toBe(413);
  });
});
