// The main key in OpenBao (issue #215): its Transit engine wraps and unwraps the data keys, and the main key never leaves it. notefeed
// logs in with an AppRole and keeps only the short-lived token. The Transit key is derived, so a data key is bound to its context
// (`feed:<fingerprint>`, `keyring:<name>`) as the local key binds it. Its versions are in the key id (`openbao:<key>:v<n>`): after a
// rotation the next start re-wraps what an older version wrapped, and the operator can then retire that version.
//
// Calls made together (a feed list, the re-wrap at start, a page's images) go as one batch request per operation. An OpenBao that does
// not answer, or answers 5xx (sealed included), is KeyServiceUnavailableError: maintenance, retried on the next request.
import { KeyServiceUnavailableError } from "../errors";
import { logger } from "../log";
import { CipherError } from "./cipher";
import { KeyringError } from "./sql/keyring";
import type { KeyWrapper } from "./wrapper";

const log = logger("openbao");

export type OpenBaoWrapper = KeyWrapper & {
  /** Resolves while OpenBao answers and is unsealed; KeyServiceUnavailableError otherwise. For /health. */
  check(): Promise<void>;
};

export type OpenBaoOptions = {
  addr: string;
  mount: string;
  key: string;
  roleId: string;
  secretId: string;
  /** The old local keys, for the start that moves to OpenBao. */
  old?: KeyWrapper | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

type Op = "encrypt" | "decrypt" | "rewrap";
type Item = Record<string, string | number>;
type Pending = { item: Item; resolve: (v: string) => void; reject: (e: unknown) => void };
type Reply = { status: number; body: { data?: { batch_results?: { error?: string; ciphertext?: string; plaintext?: string }[] } & Record<string, unknown>; auth?: { client_token: string; lease_duration: number; renewable: boolean } } };

const BATCH = 500;
const RESULT: Record<Op, "ciphertext" | "plaintext"> = { encrypt: "ciphertext", decrypt: "plaintext", rewrap: "ciphertext" };
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");

export function createOpenBaoWrapper(o: OpenBaoOptions): OpenBaoWrapper {
  const f = o.fetch ?? fetch;
  const timeoutMs = o.timeoutMs ?? 5000;
  const ID = new RegExp(`^openbao:${o.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:v(\\d+)$`);
  let versions: { latest: number; min: number } | null = null;
  let starting: Promise<void> | null = null;
  let session: { token: string; until: number; renewAt: number; renewable: boolean } | null = null;
  let loggingIn: Promise<string> | null = null;
  let reachable = true;

  const unavailable = (): never => {
    if (reachable) log.warn("key service unreachable");
    reachable = false;
    throw new KeyServiceUnavailableError();
  };

  // One HTTP request; unreachable and 5xx are maintenance. No token, no retry: those are `call`'s.
  async function send(method: string, path: string, token: string | null, body?: unknown): Promise<Reply> {
    let res: Response;
    try {
      res = await f(`${o.addr}/v1/${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(token && { "X-Vault-Token": token }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return unavailable();
    }
    if (res.status >= 500) return unavailable();
    if (!reachable) log.info("key service reachable again");
    reachable = true;
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  async function login(): Promise<string> {
    const r = await send("POST", "auth/approle/login", null, { role_id: o.roleId, secret_id: o.secretId });
    if (r.status !== 200 || !r.body.auth) throw new Error(`OpenBao refused notefeed's AppRole login (${r.status}): check NOTEFEED_OPENBAO_ROLE_ID and NOTEFEED_OPENBAO_SECRET_ID`);
    const { client_token, lease_duration, renewable } = r.body.auth;
    const now = Date.now();
    session = { token: client_token, until: now + lease_duration * 1000, renewAt: now + (lease_duration * 1000 * 2) / 3, renewable };
    return client_token;
  }

  // The token, renewed once two thirds of its lease are gone, and logged in again when that fails. One login at a time.
  async function token(): Promise<string> {
    if (loggingIn) return loggingIn;
    if (session && Date.now() < session.renewAt) return session.token;
    const p = (async () => {
      if (session?.renewable && Date.now() < session.until) {
        const r = await send("POST", "auth/token/renew-self", session.token, {});
        if (r.status === 200 && r.body.auth) {
          const now = Date.now();
          const lease = r.body.auth.lease_duration * 1000;
          session = { ...session, until: now + lease, renewAt: now + (lease * 2) / 3 };
          return session.token;
        }
      }
      return login();
    })();
    loggingIn = p;
    return p.finally(() => (loggingIn = null));
  }

  // A request with the token; a 403 means OpenBao forgot it (restarted, revoked): one new login and one more try.
  async function call(method: string, path: string, body?: unknown): Promise<Reply> {
    const r = await send(method, path, await token(), body);
    if (r.status !== 403) return r;
    session = null;
    const again = await send(method, path, await token(), body);
    if (again.status === 403) throw new Error("OpenBao refused notefeed's AppRole (403): its policy must allow encrypt, decrypt and rewrap on the transit key and read on its metadata");
    return again;
  }

  // Calls of one operation made in the same tick, sent together.
  const queues = new Map<Op, Pending[]>();
  function queued(op: Op, item: Item): Promise<string> {
    return new Promise((resolve, reject) => {
      let q = queues.get(op);
      if (!q) {
        queues.set(op, (q = []));
        queueMicrotask(() => {
          queues.delete(op);
          for (let i = 0; i < q!.length; i += BATCH) void flush(op, q!.slice(i, i + BATCH));
        });
      }
      q.push({ item, resolve, reject });
    });
  }

  async function flush(op: Op, batch: Pending[]): Promise<void> {
    try {
      const r = await call("POST", `${o.mount}/${op}/${o.key}`, { batch_input: batch.map((p) => p.item) });
      const results = r.body.data?.batch_results;
      // A batch with a failed item is a 400 that still answers every item.
      if (!results || results.length !== batch.length) throw new Error(`OpenBao ${op} failed (${r.status})`);
      results.forEach((res, i) => {
        const v = res[RESULT[op]];
        if (res.error || !v) batch[i].reject(new CipherError(`OpenBao could not ${op} the key`));
        else batch[i].resolve(v);
      });
    } catch (e) {
      for (const p of batch) p.reject(e);
    }
  }

  const known = () => {
    if (!versions) throw new Error("the OpenBao wrapper was used before start()");
    return versions;
  };
  const version = (id: string): number | null => {
    const m = ID.exec(id);
    return m ? Number(m[1]) : null;
  };
  const ours = (id: string) => {
    const v = version(id);
    return v !== null && v >= known().min && v <= known().latest;
  };

  const wrapper: OpenBaoWrapper = {
    get keyId() {
      return `openbao:${o.key}:v${known().latest}`;
    },
    caches: false,
    start() {
      if (versions) return Promise.resolve();
      starting ??= (async () => {
        const r = await call("GET", `${o.mount}/keys/${o.key}`);
        const d = r.body.data as { derived?: boolean; latest_version?: number; min_decryption_version?: number } | undefined;
        if (r.status !== 200 || !d?.derived) throw new KeyringError(`the OpenBao transit key ${o.key} must exist and be derived (derived=true)`);
        versions = { latest: d.latest_version!, min: d.min_decryption_version! };
      })().finally(() => (starting = null));
      return starting;
    },
    knows: (id) => ours(id) || (o.old?.knows(id) ?? false),
    // key_version: what the key id says, even if the key is rotated while notefeed runs.
    wrap: (dataKey, context) => queued("encrypt", { plaintext: b64(dataKey), context: b64(context), key_version: known().latest }),
    async unwrap(wrapped, id, context) {
      if (ours(id)) return Buffer.from(await queued("decrypt", { ciphertext: wrapped, context: b64(context) }), "base64");
      if (version(id) === null && o.old?.knows(id)) return o.old.unwrap(wrapped, id, context);
      throw new CipherError(`no main key with id ${id}`);
    },
    async rewrap(wrapped, id, context) {
      if (ours(id)) return queued("rewrap", { ciphertext: wrapped, context: b64(context), key_version: known().latest });
      if (version(id) === null && o.old?.knows(id)) return wrapper.wrap(await o.old.unwrap(wrapped, id, context), context);
      throw new CipherError(`no main key with id ${id}`);
    },
    async check() {
      const r = await send("GET", "sys/health", null);
      if (r.status !== 200) throw new KeyServiceUnavailableError();
    },
  };
  return wrapper;
}
