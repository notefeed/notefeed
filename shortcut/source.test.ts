// The iPhone Shortcut (#334): what it asks at import, what it posts, and that the signed file is from this source.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "plist";
import { expect, test } from "vitest";
import { shortcutPlist, shortcutSourceHash, shortcutXml } from "./source";

type Action = { WFWorkflowActionIdentifier: string; WFWorkflowActionParameters: Record<string, unknown> };
type Shortcut = {
  WFWorkflowActions: Action[];
  WFWorkflowImportQuestions: Array<{ ActionIndex: number; ParameterKey: string; Text: string; DefaultValue: string }>;
  WFWorkflowTypes: string[];
  WFWorkflowInputContentItemClasses: string[];
  WFWorkflowIcon: { WFWorkflowIconGlyphNumber: number };
};
const sc = shortcutPlist() as Shortcut;
const actions = sc.WFWorkflowActions;
const ids = actions.map((a) => a.WFWorkflowActionIdentifier.replace("is.workflow.actions.", ""));
const params = (id: string) => actions.filter((a) => a.WFWorkflowActionIdentifier === `is.workflow.actions.${id}`).map((a) => a.WFWorkflowActionParameters);
const SIGNED_FILE = join(__dirname, "..", "public", "shortcuts", "notefeed.shortcut");
const HASH_FILE = `${SIGNED_FILE}.sha256`;

// `npm run shortcut:build` runs this with UPDATE_SHORTCUT=1: it writes the unsigned property list to .shortcut-build/. Only
// `npm run shortcut:sign`, after `shortcuts sign` succeeded on a Mac, runs it with SIGNED_SHORTCUT=1 to record the source's hash
// next to the signed file. The last test keeps a source change from shipping without a newly signed file.
if (process.env.UPDATE_SHORTCUT) {
  mkdirSync(join(__dirname, "..", ".shortcut-build"), { recursive: true });
  writeFileSync(join(__dirname, "..", ".shortcut-build", "notefeed.plist"), shortcutXml());
}
if (process.env.SIGNED_SHORTCUT) writeFileSync(HASH_FILE, `${shortcutSourceHash()}\n`);

test("it shows in the share sheet for pictures, text and links, and not for other files notefeed does not take", () => {
  expect(sc.WFWorkflowTypes).toContain("ActionExtension");
  expect(sc.WFWorkflowInputContentItemClasses).toEqual(expect.arrayContaining(["WFImageContentItem", "WFStringContentItem", "WFURLContentItem"]));
  expect(sc.WFWorkflowInputContentItemClasses).not.toContain("WFPDFContentItem");
  expect(sc.WFWorkflowIcon.WFWorkflowIconGlyphNumber).not.toBe(59511); // the default magic wand
});

test("importing it asks for the address, the feed name, the feed password and the server password, in the first four actions", () => {
  const qs = sc.WFWorkflowImportQuestions;
  expect(qs.map((q) => q.Text)).toEqual([
    "notefeed address (e.g. https://notefeed.me)",
    "Feed name",
    "Feed password (empty for an open feed)",
    "Server password: optional, leave empty unless your own server asks for one at sign-in (never on notefeed.me)",
  ]);
  expect(qs.map((q) => q.ActionIndex)).toEqual([0, 1, 2, 3]);
  for (const q of qs) {
    expect(q.ParameterKey).toBe("WFTextActionText");
    expect(ids[q.ActionIndex]).toBe("gettext");
  }
});

test("pictures become JPEG without their metadata before they are posted", () => {
  expect(params("image.convert")).toEqual([expect.objectContaining({ WFImageFormat: "JPEG", WFImagePreserveMetadata: false })]);
  expect(ids.indexOf("image.convert")).toBeLessThan(ids.indexOf("downloadurl"));
});

test("everything shared is one multipart POST to the feed's notes, with the feed password; without pictures, no file field", () => {
  const posts = params("downloadurl");
  expect(posts).toHaveLength(2); // one with pictures, one without, in an If
  for (const p of posts) {
    expect(p).toMatchObject({ WFHTTPMethod: "POST", WFHTTPBodyType: "Form" });
    expect(JSON.stringify(p.WFURL)).toContain('"string":"￼/api/v1/feeds/￼/notes"');
    expect(JSON.stringify(p.WFHTTPHeaders)).toContain('"string":"X-Feed-Password"');
    expect(JSON.stringify(p.WFHTTPHeaders)).toContain('"string":"Bearer ￼"'); // the server password; ignored where there is none
  }
  const fieldsOf = (p: Record<string, unknown>) => JSON.stringify(p.WFFormValues).match(/"WFKey":\{"Value":\{"string":"(\w+)"/g)!.map((m) => m.split('"').at(-2));
  expect(fieldsOf(posts[0])).toEqual(["text", "file"]);
  // The file field: type 5, its variable wrapped in a WFTokenAttachmentParameterState (a bare attachment crashes `shortcuts sign`).
  const file = (posts[0].WFFormValues as { Value: { WFDictionaryFieldValueItems: Array<Record<string, unknown>> } }).Value.WFDictionaryFieldValueItems[1];
  expect(file).toMatchObject({
    WFItemType: 5,
    WFValue: { WFSerializationType: "WFTokenAttachmentParameterState", Value: { WFSerializationType: "WFTextTokenAttachment", Value: { Type: "Variable", VariableName: "Pictures" } } },
  });
  expect(fieldsOf(posts[1])).toEqual(["text"]);
  expect(ids.indexOf("conditional")).toBeLessThan(ids.indexOf("downloadurl"));
});

test("a note that arrived opens; a refusal shows the server's error", () => {
  expect(params("getvalueforkey").map((p) => p.WFDictionaryKey)).toEqual(["url", "error"]);
  expect(JSON.stringify(params("showresult"))).toContain("Not posted: ￼");
  expect(ids.lastIndexOf("openurl")).toBeGreaterThan(ids.lastIndexOf("downloadurl"));
});

test("it builds into a property list that reads back the same", () => {
  expect(parse(shortcutXml())).toEqual(sc);
});

test("the signed Shortcut is there, and from this source", () => {
  const stale = "Shortcut source changed or never signed: run npm run shortcut:sign on a Mac and commit public/shortcuts/";
  expect(existsSync(SIGNED_FILE), stale).toBe(true);
  expect(existsSync(HASH_FILE) && readFileSync(HASH_FILE, "utf8").trim(), stale).toBe(shortcutSourceHash());
});
