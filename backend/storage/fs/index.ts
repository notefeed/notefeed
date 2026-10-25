// The file system backend: `<DATA_DIR>/<feed>/…` (ADR 0017, 0018).
import { config } from "../../config";
import type { Storage } from "../types";
import { createFeedMethods, type FeedDeps } from "./feedindex";
import { deleteNote, listNoteRefs, noteUsage, readFeedFile, readMeta, readNote, replaceNote, updateMeta, writeNote } from "./notes";
import { readHash, removeHash, writeHash } from "./password";
import { readSettings, writeSettings } from "./settings";

export function createFsStorage(deps: FeedDeps): Storage {
  const feeds = createFeedMethods(deps, config.dataDir);
  return {
    ...feeds,
    writeNote, listNoteRefs, readNote, readMeta, replaceNote, updateMeta, deleteNote, readFile: readFeedFile,
    readSettings, writeSettings, readHash, writeHash, removeHash,
    // One feed after the other: a pass over every note folder, which is what the caller's cache is for.
    async usage() {
      const out = [];
      for (const feed of await feeds.listFeeds()) {
        out.push({ protected: (await readHash(feed)) !== null, readLink: (await feeds.feedReadId(feed)) != null, ...(await noteUsage(feed)) });
      }
      return out;
    },
  };
}
