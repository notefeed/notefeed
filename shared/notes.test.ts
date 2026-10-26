import { describe, expect, test } from "vitest";
import { extractTitle } from "./notes";

describe("extractTitle of a note that starts with a picture", () => {
  test("the title is the picture's alt text, or empty: never the raw ![](file)", () => {
    expect(extractTitle("![a grey cat](cat.png)")).toBe("a grey cat");
    expect(extractTitle("![](20261003T1-a.png)\nsome text")).toBe("");
    expect(extractTitle("  ![ spaced ](x.png)  ")).toBe("spaced");
  });
  test("a heading further down still wins, and a picture inside text is text", () => {
    expect(extractTitle("![](a.png)\n# Real title")).toBe("Real title");
    expect(extractTitle("look: ![](a.png)")).toBe("look: ![](a.png)");
  });
});

describe("extractTitle", () => {
  test("uses the first heading", () => {
    expect(extractTitle("# Backup finished\nbody")).toBe("Backup finished");
  });
  test("falls back to the first non-empty line without markers", () => {
    expect(extractTitle("\n\n- **hello** world")).toBe("hello world");
    expect(extractTitle("> quoted")).toBe("quoted");
  });
  test("is empty for blank input", () => {
    expect(extractTitle("")).toBe("");
    expect(extractTitle("   \n")).toBe("");
  });
  test("caps at 100 chars", () => {
    expect(extractTitle("x".repeat(150))).toHaveLength(100);
  });
  test("ignores BOM and CRLF", () => {
    expect(extractTitle("﻿# Title\r\nbody")).toBe("Title");
  });
});

describe("extractTitle skips fenced code", () => {
  const md = "Backup done\n\n```sh\n# run this\n```";
  test("title ignores # inside a fence", () => {
    expect(extractTitle(md)).toBe("Backup done");
    expect(extractTitle("~~~\n# no\n~~~\n# Real")).toBe("Real");
  });
});
