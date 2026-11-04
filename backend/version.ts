// The version this instance runs (#306): the image's build passes it in (NOTEFEED_VERSION from the release tag, `main` for a main
// build, NOTEFEED_COMMIT the commit); anything else, a local build or `npm run dev`, is `dev`. Shown in the info menu and the
// footer, and in /health and the MCP server's serverInfo, so people, scripts and agents can all tell.
const REPO = "https://github.com/notefeed/notefeed";

export type RunningVersion = { version: string; commit: string | null; label: string; url: string };

export function runningVersion(): RunningVersion {
  const version = process.env.NOTEFEED_VERSION?.trim() || "dev";
  const commit = process.env.NOTEFEED_COMMIT?.trim() || null;
  const release = /^\d+\.\d+\.\d+$/.test(version);
  const short = commit?.slice(0, 7);
  return {
    version,
    commit,
    label: `notefeed ${version}${!release && short ? ` (${short})` : ""}`,
    url: release ? `${REPO}/releases/tag/v${version}` : commit ? `${REPO}/commit/${commit}` : REPO,
  };
}
