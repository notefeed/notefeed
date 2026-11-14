import { expect, test } from "vitest";
import { passkeyKind } from "./passkeys";

test("a passkey's kind comes from its authenticator's AAGUID, in any case", () => {
  expect(passkeyKind("fbfc3007-154e-4ecc-8c0b-6e020557d7bd")).toBe("iCloud Keychain");
  expect(passkeyKind("EA9B8D66-4D01-1D21-3CE4-B6B48CB575D4")).toBe("Google Password Manager");
});

test("an unknown, empty or all-zero AAGUID has no kind", () => {
  expect(passkeyKind("00000000-0000-0000-0000-000000000000")).toBeUndefined();
  expect(passkeyKind("12345678-1234-1234-1234-123456789abc")).toBeUndefined();
  expect(passkeyKind(null)).toBeUndefined();
  expect(passkeyKind(undefined)).toBeUndefined();
});
