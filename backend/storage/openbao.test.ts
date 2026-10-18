// The OpenBao wrapper (issue #215) against a real OpenBao in dev mode (openbao.testkit.ts); skipped without one.
import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { KeyServiceUnavailableError } from "../errors";
import { CipherError } from "./cipher";
import { createOpenBaoWrapper } from "./openbao";
import { openBaoAddr, openBaoForTests, type OpenBaoForTests } from "./openbao.testkit";
import { KeyringError } from "./sql/keyring";
import { createLocalWrapper, createOldKeysWrapper } from "./wrapper";

const dataKey = () => randomBytes(32);

// fetch, with the requests it made: path and token.
function counting() {
  const calls: { path: string; token: string | null }[] = [];
  const f: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, token: new Headers(init?.headers).get("X-Vault-Token") });
    return fetch(input, init);
  };
  return { calls, fetch: f };
}

async function started(bao: OpenBaoForTests, o: Partial<Parameters<typeof createOpenBaoWrapper>[0]> = {}) {
  const w = createOpenBaoWrapper({ addr: bao.addr, mount: bao.mount, key: bao.key, roleId: bao.roleId, secretId: bao.secretId, ...o });
  await w.start();
  return w;
}

describe.skipIf(!openBaoAddr())("OpenBao wrapper", () => {
  test("wraps and unwraps a data key for its context", async () => {
    const bao = (await openBaoForTests())!;
    const w = await started(bao);
    expect(w.keyId).toBe(`openbao:${bao.key}:v1`);
    const k = dataKey();
    const wrapped = await w.wrap(k, "feed:a");
    expect(wrapped).toMatch(/^vault:v1:/);
    expect(await w.unwrap(wrapped, w.keyId, "feed:a")).toEqual(k);
  });

  test("refuses a key wrapped for another context", async () => {
    const w = await started((await openBaoForTests())!);
    const wrapped = await w.wrap(dataKey(), "feed:a");
    await expect(w.unwrap(wrapped, w.keyId, "feed:b")).rejects.toBeInstanceOf(CipherError);
  });

  test("batches the calls made together into one request", async () => {
    const bao = (await openBaoForTests())!;
    const c = counting();
    const w = await started(bao, { fetch: c.fetch });
    const keys = Array.from({ length: 20 }, dataKey);
    const wrapped = await Promise.all(keys.map((k, i) => w.wrap(k, `feed:${i}`)));
    const before = c.calls.length;
    const back = await Promise.all(wrapped.map((x, i) => w.unwrap(x, w.keyId, `feed:${i}`)));
    expect(back).toEqual(keys);
    expect(c.calls.slice(before).map((r) => r.path)).toEqual([`/v1/${bao.mount}/decrypt/${bao.key}`]);
  });

  test("one bad value in a batch fails only its caller", async () => {
    const w = await started((await openBaoForTests())!);
    const keys = [dataKey(), dataKey(), dataKey()];
    const wrapped = await Promise.all(keys.map((k, i) => w.wrap(k, `feed:${i}`)));
    const results = await Promise.allSettled(wrapped.map((x, i) => w.unwrap(x, w.keyId, i === 1 ? "feed:other" : `feed:${i}`)));
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(CipherError);
    expect((results[2] as PromiseFulfilledResult<Buffer>).value).toEqual(keys[2]);
  });

  test("logs in again when OpenBao forgets its token", async () => {
    const bao = (await openBaoForTests())!;
    const c = counting();
    const w = await started(bao, { fetch: c.fetch });
    const k = dataKey();
    const wrapped = await w.wrap(k, "feed:a");
    const token = c.calls.find((r) => r.token)!.token!;
    await bao.root("auth/token/revoke", { token });
    expect(await w.unwrap(wrapped, w.keyId, "feed:a")).toEqual(k);
  });

  test("a rotated key: the new version wraps, the old one still unwraps and is re-wrapped, until it is retired", async () => {
    const bao = (await openBaoForTests())!;
    const v1 = await started(bao);
    const k = dataKey();
    const old = await v1.wrap(k, "feed:a");
    await bao.root(`${bao.mount}/keys/${bao.key}/rotate`, {});
    const v2 = await started(bao);
    expect(v2.keyId).toBe(`openbao:${bao.key}:v2`);
    expect(v2.knows(v1.keyId)).toBe(true);
    const moved = await v2.rewrap(old, v1.keyId, "feed:a");
    expect(moved).toMatch(/^vault:v2:/);
    expect(await v2.unwrap(moved, v2.keyId, "feed:a")).toEqual(k);
    await bao.root(`${bao.mount}/keys/${bao.key}/config`, { min_decryption_version: 2 });
    const later = await started(bao);
    expect(later.knows(v1.keyId)).toBe(false);
    expect(later.knows(v2.keyId)).toBe(true);
    await expect(later.unwrap(old, v1.keyId, "feed:a")).rejects.toBeInstanceOf(CipherError);
  });

  test("old local keys still unwrap, and are re-wrapped under OpenBao", async () => {
    const local = "l".repeat(64);
    const before = createLocalWrapper(local);
    const k = dataKey();
    const wrapped = await before.wrap(k, "feed:a");
    const w = await started((await openBaoForTests())!, { old: createOldKeysWrapper([local]) });
    expect(w.knows(before.keyId)).toBe(true);
    expect(await w.unwrap(wrapped, before.keyId, "feed:a")).toEqual(k);
    const moved = await w.rewrap(wrapped, before.keyId, "feed:a");
    expect(await w.unwrap(moved, w.keyId, "feed:a")).toEqual(k);
  });

  test("a key id it does not know is a CipherError", async () => {
    const w = await started((await openBaoForTests())!);
    await expect(w.unwrap("vault:v1:x", "0badc0de", "feed:a")).rejects.toBeInstanceOf(CipherError);
  });

  test("an OpenBao that does not answer is maintenance, not an error", async () => {
    const bao = (await openBaoForTests())!;
    const nobody = createOpenBaoWrapper({ ...bao, addr: "http://127.0.0.1:9", timeoutMs: 1000 });
    await expect(nobody.start()).rejects.toBeInstanceOf(KeyServiceUnavailableError);
    await expect(nobody.check()).rejects.toBeInstanceOf(KeyServiceUnavailableError);

    let down = false;
    const w = await started(bao, { fetch: (input, init) => (down ? Promise.resolve(new Response("", { status: 503 })) : fetch(input, init)) });
    const wrapped = await w.wrap(dataKey(), "feed:a");
    down = true;
    await expect(w.unwrap(wrapped, w.keyId, "feed:a")).rejects.toBeInstanceOf(KeyServiceUnavailableError);
    await expect(w.check()).rejects.toBeInstanceOf(KeyServiceUnavailableError);
    down = false;
    await expect(w.check()).resolves.toBeUndefined();
  });

  test("a start that failed is tried again", async () => {
    const bao = (await openBaoForTests())!;
    let down = true;
    const w = createOpenBaoWrapper({ ...bao, fetch: (input, init) => (down ? Promise.reject(new TypeError("fetch failed")) : fetch(input, init)) });
    await expect(w.start()).rejects.toBeInstanceOf(KeyServiceUnavailableError);
    down = false;
    await w.start();
    expect(w.keyId).toBe(`openbao:${bao.key}:v1`);
  });

  test("refuses a transit key that is not derived, or none", async () => {
    const bao = (await openBaoForTests())!;
    await bao.root(`${bao.mount}/keys/plain`, {});
    await expect(started(bao, { key: "plain" })).rejects.toThrow(new KeyringError("the OpenBao transit key plain must exist and be derived (derived=true)"));
    await expect(started(bao, { key: "missing" })).rejects.toBeInstanceOf(KeyringError);
  });

  test("a wrong credential is an error, not maintenance", async () => {
    const bao = (await openBaoForTests())!;
    const e = await createOpenBaoWrapper({ ...bao, secretId: "wrong" })
      .start()
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(KeyServiceUnavailableError);
    expect(String(e)).not.toContain("wrong");
  });

  test("keeps no data key: caches is false", async () => {
    expect((await started((await openBaoForTests())!)).caches).toBe(false);
  });
});

test("the local wrapper caches, starts at once and re-wraps under its key", async () => {
  const old = createLocalWrapper("o".repeat(64));
  const k = dataKey();
  const wrapped = await old.wrap(k, "feed:a");
  const w = createLocalWrapper("n".repeat(64), ["o".repeat(64)]);
  await w.start();
  expect(w.caches).toBe(true);
  const moved = await w.rewrap(wrapped, old.keyId, "feed:a");
  expect(await w.unwrap(moved, w.keyId, "feed:a")).toEqual(k);
});

test("old keys alone only unwrap", async () => {
  const k = dataKey();
  const local = createLocalWrapper("o".repeat(64));
  const old = createOldKeysWrapper(["o".repeat(64)])!;
  expect(createOldKeysWrapper([])).toBeNull();
  expect(old.knows(local.keyId)).toBe(true);
  expect(await old.unwrap(await local.wrap(k, "feed:a"), local.keyId, "feed:a")).toEqual(k);
  await expect(old.wrap(k, "feed:a")).rejects.toThrow();
});
