// The main key (issue #212, ADR 0033): it wraps the data keys and never touches a note. The local one is the key from
// NOTEFEED_ENCRYPTION_KEY; the key service OpenBao (NOTEFEED_KMS, #215, openbao.ts) is the other. Old keys (NOTEFEED_ENCRYPTION_OLD_KEYS) only unwrap, for the
// start that wraps everything again under the new key.
import { createHash, hkdfSync } from "node:crypto";
import { config } from "../config";
import { processState } from "../state";
import { CipherError, open, seal } from "./cipher";
import { createOpenBaoWrapper, type OpenBaoWrapper } from "./openbao";

/** The main key. Async because a key service (#215) answers over the network. */
export interface KeyWrapper {
  /** The current main key's id: stored next to what it wrapped, never the key. */
  readonly keyId: string;
  /** The current key or an old one. */
  knows(keyId: string): boolean;
  /** Under the current key, bound to `context` (what the key belongs to: "feed:<fingerprint>", "keyring:<name>"). */
  wrap(dataKey: Buffer, context: string): Promise<string>;
  /** CipherError for an unknown key id, a value another key wrapped, or one wrapped for another context. */
  unwrap(wrapped: string, keyId: string, context: string): Promise<Buffer>;
  /** The same data key, wrapped under the current key: for one wrapped by an old key (or an old key version). */
  rewrap(wrapped: string, keyId: string, context: string): Promise<string>;
  /** Before `keyId` and `knows` are used: a key service logs in and learns its key's versions. Again after a failure. */
  start(): Promise<void>;
  /** Unwrapped data keys may be kept in memory. False for a key service, whose audit log is to show every use (#215). */
  readonly caches: boolean;
}

const derive = (key: string, info: string) => Buffer.from(hkdfSync("sha256", Buffer.from(key), "notefeed", info, 32));

function strong(key: string, name: string): string {
  if (Buffer.byteLength(key) < 32) throw new Error(`${name} must be at least 32 bytes (e.g. openssl rand -hex 32)`);
  return key;
}

// Each key by its id: the first 8 hex digits of a derivation, which names it without telling anything about it.
function keyRing(keys: readonly string[], name: string): Map<string, Buffer> {
  return new Map(keys.map((k) => [derive(strong(k, name), "key-id").toString("hex").slice(0, 8), derive(k, "wrap")]));
}

function unwrapWith(keys: Map<string, Buffer>, wrapped: string, id: string, context: string): Buffer {
  const k = keys.get(id);
  if (!k) throw new CipherError(`no main key with id ${id}`);
  return open(k, Buffer.from(wrapped, "base64url"), `data-key:${context}`);
}

export function createLocalWrapper(key: string, oldKeys: readonly string[] = []): KeyWrapper {
  const keys = keyRing(oldKeys, "NOTEFEED_ENCRYPTION_OLD_KEYS");
  const [[keyId, current]] = keyRing([key], "NOTEFEED_ENCRYPTION_KEY");
  keys.set(keyId, current);
  const wrap = async (dataKey: Buffer, context: string) => seal(current, dataKey, `data-key:${context}`).toString("base64url");
  return {
    keyId,
    caches: true,
    start: async () => {},
    knows: (id) => keys.has(id),
    wrap,
    unwrap: async (wrapped, id, context) => unwrapWith(keys, wrapped, id, context),
    rewrap: async (wrapped, id, context) => wrap(unwrapWith(keys, wrapped, id, context), context),
  };
}

/** The old local keys alone, beside a key service, for the start that moves to it: they unwrap and never wrap. null for none. */
export function createOldKeysWrapper(oldKeys: readonly string[]): KeyWrapper | null {
  if (oldKeys.length === 0) return null;
  const keys = keyRing(oldKeys, "NOTEFEED_ENCRYPTION_OLD_KEYS");
  const refuse = async (): Promise<never> => {
    throw new Error("an old main key only unwraps");
  };
  return {
    keyId: "",
    caches: true,
    start: async () => {},
    knows: (id) => keys.has(id),
    wrap: refuse,
    unwrap: async (wrapped, id, context) => unwrapWith(keys, wrapped, id, context),
    rewrap: refuse,
  };
}

// One per configuration, shared by the feeds' and the licenses' database: one login to the key service, and /health asks the same one.
const shared = processState("key-wrapper", () => ({}) as { keys?: string; wrapper?: KeyWrapper | null });

/** null when neither NOTEFEED_ENCRYPTION_KEY nor NOTEFEED_KMS is set: encryption is off. */
export function wrapperFromConfig(): KeyWrapper | null {
  const keys = encryptionKeys();
  if (shared.keys === keys && shared.wrapper !== undefined) return shared.wrapper;
  const key = config.encryptionKey();
  const wrapper =
    config.kms() === "openbao" ? createOpenBaoWrapper({ ...config.openbao(), old: createOldKeysWrapper(config.encryptionOldKeys()) }) : key ? createLocalWrapper(key, config.encryptionOldKeys()) : null;
  shared.keys = keys;
  shared.wrapper = wrapper;
  return wrapper;
}

/** The key service's own check, for /health; undefined without one. */
export function keyServiceCheck(): (() => Promise<void>) | undefined {
  const w = config.kms() === "openbao" ? (wrapperFromConfig() as OpenBaoWrapper) : null;
  return w ? () => w.check() : undefined;
}

/** Which main keys (or key service) are configured, as a hash: for a cache of instances built with them, which must never hold the keys. */
export const encryptionKeys = (): string => createHash("sha256").update(JSON.stringify([config.encryptionKey(), config.encryptionOldKeys(), config.kms(), config.openbao()])).digest("hex");
