import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as storageModule from "../storage";
import { healthRoute } from "./health";

beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-health-"));
  storageModule.resetStorageForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
});

test("200 ok while the storage answers, never cached", async () => {
  const res = await healthRoute();
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ status: "ok" });
});

test("503 unavailable when the storage throws, and nothing of the error in the answer", async () => {
  vi.spyOn(storageModule, "storage").mockReturnValue({ feedReadId: () => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.5:5432")) } as unknown as storageModule.Storage);
  const res = await healthRoute();
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ status: "unavailable" });
});

test("503 when the storage is misconfigured", async () => {
  vi.stubEnv("NOTEFEED_STORAGE", "nonsense");
  expect((await healthRoute()).status).toBe(503);
  vi.unstubAllEnvs();
});
