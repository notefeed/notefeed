// The file system backend: `<DATA_DIR>/<feed>/…` (ADR 0017, 0018).
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../../config";
import type { Storage } from "../types";
import { isErrno } from "./fs";
import { createFeedMethods, type FeedDeps } from "./feedindex";
import { deleteNote, hasNotes, isRemovedNote, listNoteRefs, noteUsage, readFeedFile, readMeta, readNote, renameNote, replaceNote, setDate, setDraft, takedownNotes, updateMeta, writeNote } from "./notes";
import { readHash, removeHash, writeHash } from "./password";
import { readSettings, writeSettings } from "./settings";

// Written once a pass of the migration to opaque ids completed (backend/notemigration.ts).
const marker = () => join(config.dataDir(), ".note-ids-migrated");
const exists = (path: string) => access(/*turbopackIgnore: true*/ path).then(() => true, () => false);

export function createFsStorage(deps: FeedDeps): Storage {
  const feeds = createFeedMethods(deps, config.dataDir);
  return {
    ...feeds,
    writeNote, listNoteRefs, readNote, readMeta, replaceNote, updateMeta, setDate, setDraft, renameNote, deleteNote, readFile: readFeedFile,
    takedownNotes, isRemovedNote,
    readSettings, writeSettings, readHash, writeHash, removeHash,
    // Nothing here is bound to a key: the answer is for the database backends' start while the key service is down. The marker is a
    // dot file in DATA_DIR (never a feed's name); without it, a listing per feed until one has a note.
    async migrationPending() {
      if (await exists(marker())) return false;
      for (const feed of await feeds.listFeeds()) if (await hasNotes(feed)) return true;
      return false;
    },
    async markMigrated() {
      await mkdir(/*turbopackIgnore: true*/ config.dataDir(), { recursive: true });
      await writeFile(/*turbopackIgnore: true*/ marker(), `${new Date().toISOString()}\n`, { flag: "wx" }).catch((e) => {
        if (!isErrno(e, "EEXIST")) throw e;
      });
    },
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
