import { expect, test } from "vitest";
import { LEGACY_ID, parseRecord, serializeRecord } from "./feedrecord";

const HASH = "scrypt$16384$8$1$c2FsdA==$aGFzaA==";

test("nothing stored is no record: an open feed without an owner", () => {
  expect(parseRecord(null)).toBeNull();
});

test("a bare hash, as every feed stored it before owners, is one password named Feed password", () => {
  expect(parseRecord(HASH)).toEqual({ entries: [{ id: LEGACY_ID, name: "Feed password", hash: HASH, created: 0 }] });
});

test("an owner with named passwords round-trips", () => {
  const rec = { owner: "u1", entries: [{ id: "p1", name: "blog script", hash: HASH, created: 5 }] };
  expect(parseRecord(serializeRecord(rec))).toEqual(rec);
});

test("one unnamed-by-owner legacy password and no owner is written back as the bare hash, so nothing changes for old feeds", () => {
  expect(serializeRecord({ entries: [{ id: LEGACY_ID, name: "Feed password", hash: HASH, created: 0 }] })).toBe(HASH);
});

test("no owner and no password is nothing to store", () => {
  expect(serializeRecord({ entries: [] })).toBeNull();
});

test("an owner without passwords is kept: an owned feed that is open", () => {
  expect(parseRecord(serializeRecord({ owner: "u1", entries: [] }))).toEqual({ owner: "u1", entries: [] });
});

test("a record that is neither is refused, never read as open", () => {
  expect(() => parseRecord("garbage")).toThrow();
  expect(() => parseRecord('{"entries":"x"}')).toThrow();
});
