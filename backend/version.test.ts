import { afterEach, expect, test, vi } from "vitest";
import { runningVersion } from "./version";

afterEach(() => vi.unstubAllEnvs());

test("a release links its GitHub release; a main build names its commit; nothing set is dev (#306)", () => {
  vi.stubEnv("NOTEFEED_VERSION", "0.30.0");
  vi.stubEnv("NOTEFEED_COMMIT", "81514a5abcdef");
  expect(runningVersion()).toEqual({ version: "0.30.0", commit: "81514a5abcdef", label: "notefeed 0.30.0", url: "https://github.com/notefeed/notefeed/releases/tag/v0.30.0" });
  vi.stubEnv("NOTEFEED_VERSION", "main");
  expect(runningVersion()).toMatchObject({ label: "notefeed main (81514a5)", url: "https://github.com/notefeed/notefeed/commit/81514a5abcdef" });
  vi.stubEnv("NOTEFEED_VERSION", "");
  vi.stubEnv("NOTEFEED_COMMIT", "");
  expect(runningVersion()).toEqual({ version: "dev", commit: null, label: "notefeed dev", url: "https://github.com/notefeed/notefeed" });
});
