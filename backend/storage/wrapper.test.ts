import { afterEach, describe, expect, test } from "vitest";
import { CipherError, newDataKey } from "./cipher";
import { createLocalWrapper, wrapperFromConfig } from "./wrapper";

const k1 = "a".repeat(64);
const k2 = "b".repeat(64);

describe("local key wrapper", () => {
  afterEach(() => {
    delete process.env.NOTEFEED_ENCRYPTION_KEY;
    delete process.env.NOTEFEED_ENCRYPTION_OLD_KEYS;
  });

  test("wrap then unwrap gives the data key back", async () => {
    const w = createLocalWrapper(k1);
    const d = newDataKey();
    expect((await w.unwrap(await w.wrap(d, "feed:x"), w.keyId, "feed:x")).equals(d)).toBe(true);
    await expect(w.unwrap(await w.wrap(d, "feed:x"), w.keyId, "feed:y")).rejects.toThrow(CipherError);
    expect(w.keyId).toMatch(/^[0-9a-f]{8}$/);
    expect(createLocalWrapper(k2).keyId).not.toBe(w.keyId);
  });

  test("an old key unwraps what it wrapped", async () => {
    const old = createLocalWrapper(k1);
    const d = newDataKey();
    const wrapped = await old.wrap(d, "c");
    const now = createLocalWrapper(k2, [k1]);
    expect((await now.unwrap(wrapped, old.keyId, "c")).equals(d)).toBe(true);
    expect(now.knows(old.keyId) && now.knows(now.keyId)).toBe(true);
    expect(now.keyId).toBe(createLocalWrapper(k2).keyId);
  });

  test("unwrap with an unknown key id throws CipherError", async () => {
    const w = createLocalWrapper(k1);
    const wrapped = await w.wrap(newDataKey(), "c");
    expect(createLocalWrapper(k2).knows(w.keyId)).toBe(false);
    await expect(createLocalWrapper(k2).unwrap(wrapped, w.keyId, "c")).rejects.toThrow(CipherError);
  });

  test("refuses a short key", () => {
    expect(() => createLocalWrapper("x".repeat(31))).toThrow("NOTEFEED_ENCRYPTION_KEY must be at least 32 bytes (e.g. openssl rand -hex 32)");
    expect(() => createLocalWrapper(k1, ["short"])).toThrow("NOTEFEED_ENCRYPTION_OLD_KEYS must be at least 32 bytes (e.g. openssl rand -hex 32)");
  });

  test("wrapperFromConfig reads the two variables", async () => {
    expect(wrapperFromConfig()).toBeNull();
    process.env.NOTEFEED_ENCRYPTION_KEY = k2;
    process.env.NOTEFEED_ENCRYPTION_OLD_KEYS = ` ${k1} ,`;
    const w = wrapperFromConfig()!;
    expect(w.keyId).toBe(createLocalWrapper(k2).keyId);
    expect(w.knows(createLocalWrapper(k1).keyId)).toBe(true);
  });
});
