// A dev OpenBao for the tests (issue #215): NOTEFEED_TEST_OPENBAO_ADDR and its root token NOTEFEED_TEST_OPENBAO_TOKEN, as CI starts it
// (openbao/openbao in dev mode). Each call gets a Transit mount of its own with a derived key "notefeed", and an AppRole allowed to use
// it, so tests do not see each other's keys or rotations.
import { randomBytes } from "node:crypto";

export type OpenBaoForTests = {
  addr: string;
  mount: string;
  key: string;
  roleId: string;
  secretId: string;
  /** A call with the root token: the operator's side (rotate, configure, revoke). */
  root: (path: string, body?: unknown, method?: string) => Promise<unknown>;
};

export const openBaoAddr = (): string => process.env.NOTEFEED_TEST_OPENBAO_ADDR ?? "";

/** null without NOTEFEED_TEST_OPENBAO_ADDR: the tests that need it are skipped. */
export async function openBaoForTests(): Promise<OpenBaoForTests | null> {
  const addr = openBaoAddr().replace(/\/+$/, "");
  if (!addr) return null;
  const token = process.env.NOTEFEED_TEST_OPENBAO_TOKEN || "root";
  const root = async (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") => {
    const res = await fetch(`${addr}/v1/${path}`, { method, headers: { "X-Vault-Token": token }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw new Error(`OpenBao ${method} ${path}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
  const mount = `transit-${randomBytes(4).toString("hex")}`;
  await root(`sys/mounts/${mount}`, { type: "transit" });
  await root(`${mount}/keys/notefeed`, { derived: true });
  const auths = (await root("sys/auth")) as { data: Record<string, unknown> };
  if (!auths.data["approle/"]) await root("sys/auth/approle", { type: "approle" }).catch(() => {}); // another test file may enable it first
  // Wider than production's policy (docs/self-hosting/storage.md): any key of this mount, so a test can point notefeed at another one.
  const policy = ["encrypt", "decrypt", "rewrap"].map((op) => `path "${mount}/${op}/*" { capabilities = ["update"] }`).concat(`path "${mount}/keys/*" { capabilities = ["read"] }`);
  await root(`sys/policies/acl/${mount}`, { policy: policy.join("\n") }, "PUT");
  await root(`auth/approle/role/${mount}`, { token_policies: [mount], token_ttl: "60s", token_max_ttl: "300s" });
  const roleId = ((await root(`auth/approle/role/${mount}/role-id`)) as { data: { role_id: string } }).data.role_id;
  const secretId = ((await root(`auth/approle/role/${mount}/secret-id`, {})) as { data: { secret_id: string } }).data.secret_id;
  return { addr, mount, key: "notefeed", roleId, secretId, root };
}
