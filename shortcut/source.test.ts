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
  expect(sc.WFWorkflowIcon.WFWorkflowIconGlyphNumber).not.toBe(59771); // another magic wand
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

test("the answers are cleaned up as a phone keyboard types them: spaces, capitals, no https://, a trailing slash", () => {
  // Run the Shortcut's text actions on the answers, as Shortcuts would, and read the variables they set.
  const run = (answers: string[]) => {
    const out: Record<string, string> = {};
    const vars: Record<string, string> = {};
    const arg = (t: unknown) => {
      const { string, attachmentsByRange } = (t as { Value: { string: string; attachmentsByRange: Record<string, { OutputUUID: string }> } }).Value;
      return string.replace("￼", out[Object.values(attachmentsByRange)[0].OutputUUID]);
    };
    sc.WFWorkflowActions.slice(0, 4).forEach((a, i) => (out[a.WFWorkflowActionParameters.UUID as string] = answers[i]));
    for (const { WFWorkflowActionIdentifier: id, WFWorkflowActionParameters: p } of sc.WFWorkflowActions) {
      const uuid = p.UUID as string;
      if (id.endsWith("text.trimwhitespace")) out[uuid] = arg(p.WFInput).trim();
      if (id.endsWith("text.changecase")) out[uuid] = arg(p.text).toLowerCase(); // its input is `text`, not WFInput
      if (id.endsWith("text.replace")) out[uuid] = arg(p.WFInput).replace(new RegExp(p.WFReplaceTextFind as string, "i"), p.WFReplaceTextReplace as string);
      if (id.endsWith("setvariable") && JSON.stringify(p.WFInput).includes("OutputUUID"))
        vars[p.WFVariableName as string] = out[(p.WFInput as { Value: { OutputUUID: string } }).Value.OutputUUID];
    }
    return vars;
  };
  expect(run(["notefeed.me/ ", "Homelab-7f3k ", " pw ", ""])).toEqual({ Address: "https://notefeed.me", Feed: "homelab-7f3k", "Feed password": "pw", "Server password": "" });
  expect(run(["Https://notes.example.com", "homelab", "", "secret"])).toMatchObject({ Address: "Https://notes.example.com", Feed: "homelab" });
  expect(run(["http://localhost:3000//", "a", "", ""]).Address).toBe("http://localhost:3000");
  expect(run(["", "a", "", ""]).Address).toBe("https://notefeed.me"); // the default kept: iOS leaves the answer empty
});

test("pictures become JPEG without their metadata before they are posted", () => {
  expect(params("image.convert")).toEqual([expect.objectContaining({ WFImageFormat: "JPEG", WFImagePreserveMetadata: false })]);
  expect(ids.indexOf("image.convert")).toBeLessThan(ids.indexOf("downloadurl"));
});

test("every request is a raw POST to the feed's notes, with the feed password and the server password", () => {
  const posts = params("downloadurl");
  expect(posts).toHaveLength(2); // each picture, then the note
  for (const p of posts) {
    expect(p).toMatchObject({ WFHTTPMethod: "POST", WFHTTPBodyType: "File" });
    expect(JSON.stringify(p.WFURL)).toContain('"string":"￼/api/v1/feeds/￼/notes"');
    expect(JSON.stringify(p.WFHTTPHeaders)).toContain('"string":"X-Feed-Password"');
    expect(JSON.stringify(p.WFHTTPHeaders)).toContain('"string":"Bearer ￼"'); // the server password; ignored where there is none
  }
  expect(posts.map((p) => JSON.stringify(p.WFHTTPHeaders).match(/"string":"(image\/jpeg|text\/markdown)"/)?.[1])).toEqual(["image/jpeg", "text/markdown"]);
  // No form: a file field sends only the first item of a list, and a form of text fields only is urlencoded, which notefeed refuses.
  expect(JSON.stringify(sc)).not.toContain("WFFormValues");
});

test("Add to Variable gets a variable, never a text with a variable in it (iOS adds nothing then)", () => {
  for (const p of params("appendvariable")) expect(p.WFInput).toMatchObject({ WFSerializationType: "WFTextTokenAttachment" });
});

test("it builds into a property list that reads back the same", () => {
  expect(parse(shortcutXml())).toEqual(sc);
});

test("the signed Shortcut is there, and from this source", () => {
  const stale = "Shortcut source changed or never signed: run npm run shortcut:sign on a Mac and commit public/shortcuts/";
  expect(existsSync(SIGNED_FILE), stale).toBe(true);
  expect(existsSync(HASH_FILE) && readFileSync(HASH_FILE, "utf8").trim(), stale).toBe(shortcutSourceHash());
});
