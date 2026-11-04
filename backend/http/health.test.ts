import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as storageModule from "../storage";
import * as imagesModule from "../storage/images";
import type { ImageStore } from "../storage/images/types";
import { openBaoAddr, openBaoForTests } from "../storage/openbao.testkit";
import { healthRoute } from "./health";

beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-health-"));
  storageModule.resetStorageForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const imageStore = (check: () => Promise<void>) => vi.spyOn(imagesModule, "createImageStore").mockReturnValue({ check } as unknown as ImageStore);

test("200 ok while the storage answers, never cached; no image store, no check of one", async () => {
  const res = await healthRoute();
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ status: "ok", checks: { storage: "ok" }, version: "dev" });
});

test("503 unavailable when the storage throws, and nothing of the error in the answer", async () => {
  vi.spyOn(storageModule, "storage").mockReturnValue({ feedReadId: () => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.5:5432")) } as unknown as storageModule.Storage);
  const res = await healthRoute();
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ status: "unavailable", checks: { storage: "unavailable" }, version: "dev" });
});

test("503 when the storage is misconfigured", async () => {
  vi.stubEnv("NOTEFEED_STORAGE", "nonsense");
  expect((await healthRoute()).status).toBe(503);
});

test("with an image store: 200 when it answers too", async () => {
  imageStore(() => Promise.resolve());
  const res = await healthRoute();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok", checks: { storage: "ok", images: "ok" }, version: "dev" });
});

test("with an image store that does not answer: 503, and the answer says which part", async () => {
  imageStore(() => Promise.reject(new Error("image store: check failed (no answer)")));
  const res = await healthRoute();
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ status: "unavailable", checks: { storage: "ok", images: "unavailable" }, version: "dev" });
});

test("a wrong NOTEFEED_IMAGES fails the storage check and adds none of its own", async () => {
  vi.stubEnv("NOTEFEED_IMAGES", "nonsense");
  storageModule.resetStorageForTests();
  const res = await healthRoute();
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ status: "unavailable", checks: { storage: "unavailable" }, version: "dev" });
});

// The main key in OpenBao (#215): its own check, since every feed needs it.
async function withKeyService(bao: { addr: string; mount?: string; key?: string; roleId?: string; secretId?: string }) {
  vi.stubEnv("NOTEFEED_STORAGE", "sqlite");
  vi.stubEnv("NOTEFEED_SECRET", "s".repeat(32));
  vi.stubEnv("NOTEFEED_KMS", "openbao");
  vi.stubEnv("NOTEFEED_OPENBAO_ADDR", bao.addr);
  vi.stubEnv("NOTEFEED_OPENBAO_MOUNT", bao.mount ?? "transit");
  vi.stubEnv("NOTEFEED_OPENBAO_KEY", bao.key ?? "notefeed");
  vi.stubEnv("NOTEFEED_OPENBAO_ROLE_ID", bao.roleId ?? "role");
  vi.stubEnv("NOTEFEED_OPENBAO_SECRET_ID", bao.secretId ?? "secret");
  storageModule.resetStorageForTests();
}

test("with the key service: 503 while it does not answer, with checks.keys saying so", async () => {
  await withKeyService({ addr: "http://127.0.0.1:9" });
  const res = await healthRoute();
  expect(res.status).toBe(503);
  expect((await res.json()).checks).toEqual({ storage: "unavailable", keys: "unavailable" });
});

test.skipIf(!openBaoAddr())("with the key service: 200 while it answers", async () => {
  await withKeyService((await openBaoForTests())!);
  const res = await healthRoute();
  expect(await res.json()).toEqual({ status: "ok", checks: { storage: "ok", keys: "ok" }, version: "dev" });
});
