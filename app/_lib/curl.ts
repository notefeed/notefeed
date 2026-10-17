import { feedPath, locked } from "@/backend";

// The curl line that posts a note to the feed, with the credentials this instance and this feed ask for.
export function curlFor(base: string, feed: string, feedPassword: boolean): string {
  const auth = (locked() ? ` -H "Authorization: Bearer $NOTEFEED_PASSWORD"` : "") + (feedPassword ? ` -H "X-Feed-Password: $NOTEFEED_FEED_PASSWORD"` : "");
  return `curl${auth} -H "Content-Type: text/markdown" -d "# Hello" ${base}${feedPath(feed)}`;
}

// The command that adds this instance's MCP endpoint to Claude Code; a locked instance takes its password as a Bearer header
// (docs/integrations/mcp.md). A feed's own password is a parameter of each tool, not a header.
export function claudeMcpFor(base: string): string {
  return `claude mcp add notefeed --transport http ${base}/mcp` + (locked() ? ` --header "Authorization: Bearer $NOTEFEED_PASSWORD"` : "");
}
