// An account's license (#391, ADR 0061): its subscriptions at the payment provider, in a table of notefeed's own in accounts.sqlite next
// to the accounts, so an account and its subscriptions change in one file and a restore of the notes can't bring back a lapsed license
// or drop a paid one. Their `units` added up are how many of the account's feeds the license covers; which feeds is stored with each
// feed (feedrecord.ts `covered`), so no feed name is written here. Nothing about the buyer is: the provider's references only (V2).
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config";
import { processState } from "../state";

export type Subscription = {
  providerRef: string;
  account: string;
  customerRef: string | null;
  period: "month" | "year";
  units: number;
  status: "active" | "lapsed";
  /** When the paid period ends (ms); null while the provider gave no date. */
  validUntil: number | null;
};

const state = processState("subscriptions", () => ({}) as { file?: string; db?: Database.Database });

function db(): Database.Database {
  const file = config.accountsDb();
  if (state.db && state.file === file) return state.db;
  state.db?.close();
  mkdirSync(dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma("journal_mode = WAL");
  d.exec(`create table if not exists subscription (
    provider_ref text primary key,
    account text not null,
    customer_ref text,
    period text not null,
    units integer not null,
    status text not null,
    valid_until integer,
    created_at integer not null
  );
  create index if not exists subscription_account on subscription (account);`);
  state.file = file;
  return (state.db = d);
}

// Made with the accounts' own tables (migrateAccounts).
export const migrateSubscriptions = (): void => void db();

type Row = { provider_ref: string; account: string; customer_ref: string | null; period: string; units: number; status: string; valid_until: number | null };
const of = (r: Row): Subscription => ({
  providerRef: r.provider_ref,
  account: r.account,
  customerRef: r.customer_ref,
  period: r.period === "year" ? "year" : "month",
  units: r.units,
  status: r.status === "lapsed" ? "lapsed" : "active",
  validUntil: r.valid_until,
});

// A new subscription, or the same one again (a webhook delivered twice): its account stays the first one's.
export async function putSubscription(s: Omit<Subscription, "status"> & { status?: Subscription["status"] }): Promise<Subscription> {
  db()
    .prepare(
      `insert into subscription (provider_ref, account, customer_ref, period, units, status, valid_until, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?) on conflict (provider_ref) do update set
       units = excluded.units, status = excluded.status, valid_until = excluded.valid_until, customer_ref = coalesce(excluded.customer_ref, customer_ref)`,
    )
    .run(s.providerRef, s.account, s.customerRef, s.period, s.units, s.status ?? "active", s.validUntil, Date.now());
  return (await subscriptionByRef(s.providerRef))!;
}

export const subscriptionByRef = async (ref: string): Promise<Subscription | null> => {
  const r = db().prepare("select * from subscription where provider_ref = ?").get(ref) as Row | undefined;
  return r ? of(r) : null;
};

export const subscriptionsOf = async (account: string): Promise<Subscription[]> =>
  (db().prepare("select * from subscription where account = ? order by created_at").all(account) as Row[]).map(of);

export async function updateSubscription(ref: string, patch: Partial<Pick<Subscription, "units" | "status" | "validUntil">>): Promise<boolean> {
  const cur = await subscriptionByRef(ref);
  if (!cur) return false;
  const next = { ...cur, ...patch };
  db().prepare("update subscription set units = ?, status = ?, valid_until = ? where provider_ref = ?").run(next.units, next.status, next.validUntil, ref);
  return true;
}

export const deleteSubscriptionsOf = async (account: string): Promise<void> => void db().prepare("delete from subscription where account = ?").run(account);

// Paid for now: active, and its period not over (a lapsed period counts even if the provider's webhook for it never came).
export const isActive = (s: Subscription, now = Date.now()): boolean => s.status === "active" && (s.validUntil === null || s.validUntil > now);

export const activeUnits = async (account: string, now = Date.now()): Promise<number> =>
  (await subscriptionsOf(account)).filter((s) => isActive(s, now)).reduce((n, s) => n + s.units, 0);

// For the operator's metrics: subscriptions paid for now, and those lapsed.
export function subscriptionCounts(now = Date.now()): { active: number; lapsed: number; units: number } {
  const rows = (db().prepare("select * from subscription").all() as Row[]).map(of);
  const active = rows.filter((s) => isActive(s, now));
  return { active: active.length, lapsed: rows.length - active.length, units: active.reduce((n, s) => n + s.units, 0) };
}

export function resetSubscriptionsForTests(): void {
  state.db?.close();
  state.db = undefined;
  state.file = undefined;
}
