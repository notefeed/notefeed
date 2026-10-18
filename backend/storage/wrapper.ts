// The main key (issue #212, ADR 0033): it wraps the data keys and never touches a note. This is the one implementation for now, the
// key from NOTEFEED_ENCRYPTION_KEY; a key service is a second one (#215). Old keys (NOTEFEED_ENCRYPTION_OLD_KEYS) only unwrap, for the
// start that wraps everything again under the new key.
import { createHash, hkdfSync } from "node:crypto";
import { config } from "../config";
import { CipherError, open, seal } from "./cipher";

/** The main key. Async because a key service (#215) answers over the network. */
export interface KeyWrapper {
  /** The current main key's id: stored next to what it wrapped, never the key. */
  readonly keyId: string;
  /** The current key or an old one. */
  knows(keyId: string): boolean;
  /** Under the current key. */
  wrap(dataKey: Buffer): Promise<string>;
  /** CipherError for an unknown key id or a value another key wrapped. */
  unwrap(wrapped: string, keyId: string): Promise<Buffer>;
}

const AAD = "data-key";
const derive = (key: string, info: string) => Buffer.from(hkdfSync("sha256", Buffer.from(key), "notefeed", info, 32));

function strong(key: string, name: string): string {
  if (Buffer.byteLength(key) < 32) throw new Error(`${name} must be at least 32 bytes (e.g. openssl rand -hex 32)`);
  return key;
}

export function createLocalWrapper(key: string, oldKeys: readonly string[] = []): KeyWrapper {
  const keys = new Map<string, Buffer>();
  const add = (k: string) => keys.set(derive(k, "key-id").toString("hex").slice(0, 8), derive(k, "wrap"));
  for (const k of oldKeys) add(strong(k, "NOTEFEED_ENCRYPTION_OLD_KEYS"));
  const keyId = derive(strong(key, "NOTEFEED_ENCRYPTION_KEY"), "key-id").toString("hex").slice(0, 8);
  add(key);
  return {
    keyId,
    knows: (id) => keys.has(id),
    wrap: async (dataKey) => seal(keys.get(keyId)!, dataKey, AAD).toString("base64url"),
    async unwrap(wrapped, id) {
      const k = keys.get(id);
      if (!k) throw new CipherError(`no main key with id ${id}`);
      return open(k, Buffer.from(wrapped, "base64url"), AAD);
    },
  };
}

/** null when NOTEFEED_ENCRYPTION_KEY is empty: encryption is off. */
export function wrapperFromConfig(): KeyWrapper | null {
  const key = config.encryptionKey();
  return key ? createLocalWrapper(key, config.encryptionOldKeys()) : null;
}

/** Which main keys are configured, as a hash: for a cache of instances built with them, which must never hold the keys. */
export const encryptionKeys = (): string => createHash("sha256").update(JSON.stringify([config.encryptionKey(), config.encryptionOldKeys()])).digest("hex");
