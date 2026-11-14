import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { encodeHeaderValue } from "../shared/headers";
import { InvalidBodyError } from "./errors";
import { checkNoteMeta, NOTE_FIELDS, readNoteHeaders } from "./notefields";

const h = (headers: Record<string, string>) => new Headers(headers);

describe("readNoteHeaders", () => {
  test("reads each field's header: UTF-8 bytes decoded, trimmed, an empty header is none", () => {
    expect(
      readNoteHeaders(
        h({
          "x-note-title": encodeHeaderValue(" Café "),
          "x-note-sender": "",
          "x-note-tags": " ci, deploy ,",
          "x-note-date": "2025-03-01",
          "x-note-draft": "TRUE",
          "x-note-alt": "a cat",
          "x-note-name": "a.png",
        }),
      ),
    ).toEqual({ title: "Café", tags: ["ci", "deploy"], date: "2025-03-01", draft: true, alt: "a cat", name: "a.png" });
  });

  test("only the fields asked for", () => {
    expect(readNoteHeaders(h({ "x-note-title": "T", "x-note-alt": "A" }), ["title"])).toEqual({ title: "T" });
  });

  test("X-Note-Draft other than true or false is a bad request", () => {
    expect(() => readNoteHeaders(h({ "x-note-draft": "yes" }))).toThrow(InvalidBodyError);
  });
});

describe("checkNoteMeta", () => {
  test.each(["title", "sender", "alt"] as const)("%s: one line of at most its length, trimmed", (field) => {
    const max = NOTE_FIELDS[field].max!;
    expect(checkNoteMeta({ [field]: "  x " })[field]).toBe("x");
    for (const bad of ["a\nb", "a‮b", "x".repeat(max + 1)]) expect(() => checkNoteMeta({ [field]: bad }), JSON.stringify(bad)).toThrow(new RegExp(field));
  });

  test("tags are folded and checked, a date is parsed", () => {
    expect(checkNoteMeta({ tags: ["CI", "ci"], date: "2025-03-01" })).toMatchObject({ tags: ["ci"], date: new Date("2025-03-01T00:00:00Z") });
    expect(() => checkNoteMeta({ tags: ["no spaces"] })).toThrow(InvalidBodyError);
    expect(() => checkNoteMeta({ date: "yesterday" })).toThrow(InvalidBodyError);
  });
});

test("the REST post takes every field's header, as openapi.json says", () => {
  const spec = JSON.parse(readFileSync("openapi.json", "utf8"));
  const params = spec.paths["/api/v1/feeds/{feed}/notes"].post.parameters.map((p: { name: string }) => p.name);
  expect(params).toEqual(expect.arrayContaining(Object.values(NOTE_FIELDS).map((f) => f.header)));
});
