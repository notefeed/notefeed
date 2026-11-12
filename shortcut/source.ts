// The iPhone Shortcut "notefeed" (#334), as source. iOS doesn't put web apps in the share sheet (#148); this Shortcut is there instead.
// Importing it asks four things: the instance's address, the feed's name, its password (empty for an open feed) and the instance's
// password (empty unless the server has one, NOTEFEED_PASSWORD: an instance without one ignores the header). Everything shared
// in one go becomes one note (ADR 0021): the text, if any, with every picture, posted to POST /api/v1/feeds/<feed>/notes as one
// multipart request. Photos are converted to JPEG on the phone, since notefeed does not take HEIC. A refusal is shown with the
// server's `error`; a note that arrived opens in the browser.
// iOS imports only signed Shortcuts: `npm run shortcut:sign` on a Mac signs this into public/shortcuts/notefeed.shortcut and records
// the source's hash next to it (checked by source.test.ts). Apple doesn't document the format; the keys below are the ones Shortcuts
// itself writes (the identifiers and glyphs as listed by cherri, https://github.com/electrikmilk/cherri).
import { createHash } from "node:crypto";
import { build, type PlistValue } from "plist";

const ADDRESS = "6E0F3A1C-2B4D-4C5E-8F60-71829304A501";
const FEED = "6E0F3A1C-2B4D-4C5E-8F60-71829304A502";
const PASSWORD = "6E0F3A1C-2B4D-4C5E-8F60-71829304A503";
const INSTANCE = "6E0F3A1C-2B4D-4C5E-8F60-71829304A50E";
const IMAGES = "6E0F3A1C-2B4D-4C5E-8F60-71829304A504";
const EACH = "6E0F3A1C-2B4D-4C5E-8F60-71829304A505";
const JPEG = "6E0F3A1C-2B4D-4C5E-8F60-71829304A506";
const TEXT = "6E0F3A1C-2B4D-4C5E-8F60-71829304A507";
const WITH_PICTURES = "6E0F3A1C-2B4D-4C5E-8F60-71829304A508";
const POST_PICTURES = "6E0F3A1C-2B4D-4C5E-8F60-71829304A509";
const POST_TEXT = "6E0F3A1C-2B4D-4C5E-8F60-71829304A50A";
const URL_OF = "6E0F3A1C-2B4D-4C5E-8F60-71829304A50B";
const ARRIVED = "6E0F3A1C-2B4D-4C5E-8F60-71829304A50C";
const ERROR_OF = "6E0F3A1C-2B4D-4C5E-8F60-71829304A50D";
const PICTURES = "Pictures";
const ANSWER = "Answer";

type Attachment = Record<string, unknown>;
const output = (uuid: string, name: string): Attachment => ({ Type: "ActionOutput", OutputUUID: uuid, OutputName: name });
const variable = (name: string): Attachment => ({ Type: "Variable", VariableName: name });
/** One variable as a parameter. */
const value = (a: Attachment) => ({ Value: a, WFSerializationType: "WFTextTokenAttachment" });
/** Text with variables in it: each "￼" in `template` is the next of `parts`. */
function text(template: string, ...parts: Attachment[]) {
  const attachmentsByRange: Record<string, Attachment> = {};
  let at = 0;
  for (const part of parts) {
    at = template.indexOf("￼", at);
    attachmentsByRange[`{${at}, 1}`] = part;
    at++;
  }
  return { Value: { string: template, attachmentsByRange }, WFSerializationType: "WFTextTokenString" };
}
const action = (id: string, params: Record<string, unknown>) => ({ WFWorkflowActionIdentifier: `is.workflow.actions.${id}`, WFWorkflowActionParameters: params });
/** "If `a` has any value" (mode 0), "Otherwise" (1) and "End If" (2) of one block. */
const ifHasValue = (group: string, a: Attachment) =>
  action("conditional", { GroupingIdentifier: group, WFControlFlowMode: 0, WFCondition: 100, WFInput: { Type: "Variable", Variable: value(a) } });
const otherwise = (group: string) => action("conditional", { GroupingIdentifier: group, WFControlFlowMode: 1 });
const endIf = (group: string) => action("conditional", { GroupingIdentifier: group, WFControlFlowMode: 2 });

// A form field: text (type 0) or a file (type 5), as Shortcuts writes WFFormValues. A file field's value is the variable wrapped once more,
// in a WFTokenAttachmentParameterState (as the Cherri compiler writes it); the bare attachment makes `shortcuts sign` crash with "State
// for WFPropertyListParameterValue is not of the expected class".
const field = (key: string, type: 0 | 5, v: Attachment) => ({
  WFItemType: type,
  WFKey: text(key),
  WFValue: type === 0 ? text("￼", v) : { Value: value(v), WFSerializationType: "WFTokenAttachmentParameterState" },
});
const form = (...fields: ReturnType<typeof field>[]) => ({ Value: { WFDictionaryFieldValueItems: fields }, WFSerializationType: "WFDictionaryFieldValue" });

// POST /api/v1/feeds/<feed>/notes, with the feed's password (an empty header is no password, so an open feed needs nothing) and the
// instance's (checked only where the instance has one; elsewhere the header is ignored, empty or not).
const post = (uuid: string, fields: ReturnType<typeof field>[]) =>
  action("downloadurl", {
    UUID: uuid,
    WFURL: text("￼/api/v1/feeds/￼/notes", output(ADDRESS, "Text"), output(FEED, "Text")),
    WFHTTPMethod: "POST",
    WFHTTPBodyType: "Form",
    WFFormValues: form(...fields),
    ShowHeaders: true,
    WFHTTPHeaders: form(field("X-Feed-Password", 0, output(PASSWORD, "Text")), { WFItemType: 0, WFKey: text("Authorization"), WFValue: text("Bearer ￼", output(INSTANCE, "Text")) }),
  });

/** The Shortcut as the dictionary its file holds. */
export function shortcutPlist(): Record<string, unknown> {
  return {
    // Shortcuts on iOS 26.
    WFWorkflowClientVersion: "4033.0.4.3",
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: "900",
    // A sheet of paper, in dark grey: notefeed's own colour is carbon.
    WFWorkflowIcon: { WFWorkflowIconStartColor: 255, WFWorkflowIconGlyphNumber: 59771 },
    WFWorkflowTypes: ["ActionExtension"],
    WFWorkflowHasShortcutInputVariables: true,
    // notefeed takes markdown and pictures: images, text and links, nothing else.
    WFWorkflowInputContentItemClasses: ["WFImageContentItem", "WFStringContentItem", "WFRichTextContentItem", "WFURLContentItem"],
    // What the settings page shows: the address, the feed's name, its password and whether the instance has one.
    WFWorkflowImportQuestions: [
      { ActionIndex: 0, Category: "Parameter", DefaultValue: "https://notefeed.me", ParameterKey: "WFTextActionText", Text: "notefeed address (e.g. https://notefeed.me)" },
      { ActionIndex: 1, Category: "Parameter", DefaultValue: "", ParameterKey: "WFTextActionText", Text: "Feed name" },
      { ActionIndex: 2, Category: "Parameter", DefaultValue: "", ParameterKey: "WFTextActionText", Text: "Feed password (empty for an open feed)" },
      { ActionIndex: 3, Category: "Parameter", DefaultValue: "", ParameterKey: "WFTextActionText", Text: "Server password: optional, leave empty unless your own server asks for one at sign-in (never on notefeed.me)" },
    ],
    WFWorkflowActions: [
      action("gettext", { UUID: ADDRESS, WFTextActionText: "" }),
      action("gettext", { UUID: FEED, WFTextActionText: "" }),
      action("gettext", { UUID: PASSWORD, WFTextActionText: "" }),
      action("gettext", { UUID: INSTANCE, WFTextActionText: "" }),
      // The pictures, each as JPEG without its metadata (the server strips and shrinks it again anyway).
      action("detect.images", { UUID: IMAGES, WFInput: value({ Type: "ExtensionInput" }) }),
      action("repeat.each", { UUID: EACH, GroupingIdentifier: EACH, WFControlFlowMode: 0, WFInput: value(output(IMAGES, "Images")) }),
      action("image.convert", { UUID: JPEG, WFInput: value(variable("Repeat Item")), WFImageFormat: "JPEG", WFImagePreserveMetadata: false }),
      action("appendvariable", { WFVariableName: PICTURES, WFInput: value(output(JPEG, "Converted Image")) }),
      action("repeat.each", { GroupingIdentifier: EACH, WFControlFlowMode: 2 }),
      // The text or link shared, if any: the note's text. Empty is fine: then the pictures are the note.
      action("detect.text", { UUID: TEXT, WFInput: value({ Type: "ExtensionInput" }) }),
      // One request. A form's file field with nothing in it is a part the server refuses, so without pictures there is none.
      ifHasValue(WITH_PICTURES, variable(PICTURES)),
      post(POST_PICTURES, [field("text", 0, output(TEXT, "Text")), field("file", 5, variable(PICTURES))]),
      action("setvariable", { WFVariableName: ANSWER, WFInput: value(output(POST_PICTURES, "Contents of URL")) }),
      otherwise(WITH_PICTURES),
      post(POST_TEXT, [field("text", 0, output(TEXT, "Text"))]),
      action("setvariable", { WFVariableName: ANSWER, WFInput: value(output(POST_TEXT, "Contents of URL")) }),
      endIf(WITH_PICTURES),
      // The answer: the note's `url` to open, or the server's `error` to show.
      action("getvalueforkey", { UUID: URL_OF, WFInput: value(variable(ANSWER)), WFDictionaryKey: "url" }),
      ifHasValue(ARRIVED, output(URL_OF, "Dictionary Value")),
      action("openurl", { WFInput: value(output(URL_OF, "Dictionary Value")) }),
      otherwise(ARRIVED),
      action("getvalueforkey", { UUID: ERROR_OF, WFInput: value(variable(ANSWER)), WFDictionaryKey: "error" }),
      action("showresult", { Text: text("Not posted: ￼", output(ERROR_OF, "Dictionary Value")) }),
      endIf(ARRIVED),
    ],
  };
}

/** The Shortcut as an XML property list (unsigned; `plutil -convert binary1` and `shortcuts sign` make the file iOS imports). */
export const shortcutXml = (): string => build(shortcutPlist() as PlistValue);

/** The source's fingerprint, recorded next to the signed file when it is signed. */
export const shortcutSourceHash = (): string => createHash("sha256").update(shortcutXml()).digest("hex");
