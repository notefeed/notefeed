import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// server.json describes the hosted MCP server to registries and directories (M8ven reads it): a remote, so no environment
// variables of its own. Its version moves with every release, as the client packages' do.
const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

test("server.json names the release the client packages are at, and only the remote endpoint", () => {
  const server = json("./server.json");
  expect(server.version).toBe(json("./packages/js/package.json").version);
  expect(server.remotes).toEqual([{ type: "streamable-http", url: "https://notefeed.me/mcp" }]);
  expect(server.packages).toBeUndefined();
});
