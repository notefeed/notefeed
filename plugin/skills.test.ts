import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// The skills name MCP tools in backticks; a renamed or removed tool must not leave them stale.
const tools = new Set([...readFileSync("backend/mcp.ts", "utf8").matchAll(/registerTool\(\s*"(\w+)"/g)].map((m) => m[1]));
const dir = "plugin/skills";

describe.each(readdirSync(dir))("skill %s", (name) => {
  const text = readFileSync(join(dir, name, "SKILL.md"), "utf8");
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";

  test("has a name matching its folder and a description", () => {
    expect(front).toMatch(new RegExp(`^name: ${name}$`, "m"));
    expect(front).toMatch(/^description: .{50,1024}$/m);
  });

  test("names only tools the MCP endpoint has", () => {
    const named = [...text.matchAll(/`((?:post|list|get|edit|delete|update)_(?:note|notes|feed|file))`/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((t) => !tools.has(t))).toEqual([]);
  });
});

test("the marketplace points at the plugin", () => {
  const market = JSON.parse(readFileSync(".claude-plugin/marketplace.json", "utf8"));
  const plugin = JSON.parse(readFileSync("plugin/.claude-plugin/plugin.json", "utf8"));
  expect(market.plugins).toEqual([expect.objectContaining({ name: plugin.name, source: "./plugin" })]);
});
