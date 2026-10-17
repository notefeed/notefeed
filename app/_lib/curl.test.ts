import { afterEach, expect, test, vi } from "vitest";
import { claudeMcpFor, curlFor } from "./curl";

afterEach(() => vi.unstubAllEnvs());

test("the snippet declares the note's type: a post without a Content-Type is refused", () => {
  expect(curlFor("https://notes.example", "f", false)).toBe(`curl -H "Content-Type: text/markdown" -d "# Hello" https://notes.example/f`);
});

test("with the instance password and the feed's password the headers come first", () => {
  vi.stubEnv("NOTEFEED_PASSWORD", "pw");
  expect(curlFor("https://notes.example", "f", true)).toBe(
    `curl -H "Authorization: Bearer $NOTEFEED_PASSWORD" -H "X-Feed-Password: $NOTEFEED_FEED_PASSWORD" -H "Content-Type: text/markdown" -d "# Hello" https://notes.example/f`,
  );
});

test("the Claude Code command adds the instance's MCP endpoint, with the instance password where there is one", () => {
  expect(claudeMcpFor("https://notes.example")).toBe("claude mcp add notefeed --transport http https://notes.example/mcp");
  vi.stubEnv("NOTEFEED_PASSWORD", "pw");
  expect(claudeMcpFor("https://notes.example")).toBe(`claude mcp add notefeed --transport http https://notes.example/mcp --header "Authorization: Bearer $NOTEFEED_PASSWORD"`);
});
