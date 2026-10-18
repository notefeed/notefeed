// Encryption at rest (issue #212, ADR 0033): the primitives. A value is sealed with AES-256-GCM under a 32-byte data key, bound to
// where it belongs by its associated data (aad), so a value moved to another row does not open. Lookups go by fingerprints, an HMAC
// under the database's fingerprint key: the same value always gives the same fingerprint, and nobody without the key can make one.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export type FingerprintKind = "feed" | "read_id" | "provider_ref";

/** A value that does not open: another key, another aad, or changed bytes. Never read as empty. */
export class CipherError extends Error {
  constructor(message = "a stored value could not be decrypted") {
    super(message);
    this.name = "CipherError";
  }
}

const NONCE = 12;
const TAG = 16;

export const newDataKey = (): Buffer => randomBytes(32);

/** nonce ‖ ciphertext ‖ tag. */
export function seal(key: Buffer, plain: Uint8Array, aad: string): Buffer {
  const nonce = randomBytes(NONCE);
  const c = createCipheriv("aes-256-gcm", key, nonce);
  c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([nonce, body, c.getAuthTag()]);
}

export function open(key: Buffer, sealed: Uint8Array, aad: string): Buffer {
  const b = Buffer.from(sealed);
  if (b.byteLength < NONCE + TAG) throw new CipherError();
  try {
    const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, NONCE));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(b.subarray(b.byteLength - TAG));
    return Buffer.concat([d.update(b.subarray(NONCE, b.byteLength - TAG)), d.final()]);
  } catch {
    throw new CipherError();
  }
}

export const sealText = (key: Buffer, plain: string, aad: string): string => seal(key, Buffer.from(plain), aad).toString("base64url");
export const openText = (key: Buffer, sealed: string, aad: string): string => open(key, Buffer.from(sealed, "base64url"), aad).toString("utf8");

export const fingerprint = (key: Buffer, kind: FingerprintKind, value: string): string => createHmac("sha256", key).update(`${kind}:${value}`).digest("base64url");
