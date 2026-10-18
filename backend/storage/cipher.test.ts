import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { CipherError, fingerprint, newDataKey, open, openText, seal, sealText } from "./cipher";

describe("cipher", () => {
  const key = newDataKey();

  test("seal then open gives the bytes back", () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x00, 0xff, 0x00, 0x0a]);
    expect(new Uint8Array(open(key, seal(key, bytes, "a"), "a"))).toEqual(bytes);
    expect(open(key, seal(key, new Uint8Array(), "a"), "a").byteLength).toBe(0);
    expect(openText(key, sealText(key, "Grüße", "t"), "t")).toBe("Grüße");
  });

  test("two seals of the same value differ", () => {
    const b = Buffer.from("same");
    expect(seal(key, b, "a").equals(seal(key, b, "a"))).toBe(false);
  });

  test("open refuses another aad, a flipped byte, another key", () => {
    const sealed = seal(key, Buffer.from("value"), "a");
    expect(() => open(key, sealed, "b")).toThrow(CipherError);
    const flipped = Buffer.from(sealed);
    flipped[flipped.length - 1] ^= 1;
    expect(() => open(key, flipped, "a")).toThrow(CipherError);
    expect(() => open(newDataKey(), sealed, "a")).toThrow(CipherError);
    expect(() => open(key, Buffer.from("short"), "a")).toThrow(CipherError);
  });

  test("a data key is 32 random bytes", () => {
    expect(newDataKey().byteLength).toBe(32);
    expect(newDataKey().equals(newDataKey())).toBe(false);
  });

  test("fingerprints are stable and keyed", () => {
    expect(fingerprint(key, "feed", "f")).toBe(fingerprint(key, "feed", "f"));
    expect(fingerprint(randomBytes(32), "feed", "f")).not.toBe(fingerprint(key, "feed", "f"));
    expect(fingerprint(key, "feed", "f")).not.toBe(fingerprint(key, "read_id", "f"));
    expect(fingerprint(key, "feed", "f")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("fingerprints keep read ids case-sensitive", () => {
    expect(fingerprint(key, "read_id", "AbC")).not.toBe(fingerprint(key, "read_id", "abc"));
  });
});
