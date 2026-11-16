// An account's license (#391, ADR 0061): its subscriptions at the payment provider, in a table of notefeed's own in accounts.sqlite next
// to the accounts, so an account and its subscriptions change in one file and a restore of the notes can't bring back a lapsed license
// or drop a paid one. Their `units` added up are how many of the account's feeds the license covers; which feeds is stored with each
// feed (feedrecord.ts `covered`), so no feed name is written here. Nothing about the buyer is: the provider's references only (V2).
import Database from "better-sqlite3";
import { Kysely, sql, SqliteDialect, type Selectable } from "kysely";
import { Migrator, type Migration } from "kysely/migration";
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

type Table = {
  provider_ref: string;
  account: string;
  customer_ref: string | null;
  period: string;
  units: number;
  status: string;
  valid_until: number | null;
  created_at: number;
};
type Db = Kysely<{ subscription: Table }>;

// The table's schema changes, in order, recorded in their own table so they never mix with Better Auth's. Never edit one that has
// shipped; add the next. The migrations run against whatever the schema was when they were written, so the database is untyped here.
/* eslint-disable @typescript-eslint/no-explicit-any */
const MIGRATIONS: Record<string, Migration> = {
  "001_subscription": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("subscription")
        .ifNotExists()
        .addColumn("provider_ref", "text", (c) => c.primaryKey())
        .addColumn("account", "text", (c) => c.notNull())
        .addColumn("customer_ref", "text")
        .addColumn("period", "text", (c) => c.notNull())
        .addColumn("units", "integer", (c) => c.notNull())
        .addColumn("status", "text", (c) => c.notNull())
        .addColumn("valid_until", "integer")
        .addColumn("created_at", "integer", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("subscription_account").ifNotExists().on("subscription").column("account").execute();
    },
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

const state = processState("subscriptions", () => ({}) as { file?: string; db?: Promise<Db> });

// accounts.sqlite, migrated once per file (a test's DATA_DIR changes it).
function db(): Promise<Db> {
  const file = config.accountsDb();
  if (state.db && state.file === file) return state.db;
  const old = state.db;
  state.file = file;
  state.db = (async () => {
    await old?.then((d) => d.destroy()).catch(() => undefined);
    mkdirSync(dirname(file), { recursive: true });
    const sqlite = new Database(file);
    sqlite.pragma("journal_mode = WAL");
    const d: Db = new Kysely({ dialect: new SqliteDialect({ database: sqlite }) });
    const migrator = new Migrator({
      db: d,
      provider: { getMigrations: async () => MIGRATIONS },
      migrationTableName: "subscription_migration",
      migrationLockTableName: "subscription_migration_lock",
    });
    const { error } = await migrator.migrateToLatest();
    if (error) throw error;
    return d;
  })();
  return state.db;
}

// Made with the accounts' own tables (migrateAccounts).
export const migrateSubscriptions = async (): Promise<void> => void (await db());

const of = (r: Selectable<Table>): Subscription => ({
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
  await (
    await db()
  )
    .insertInto("subscription")
    .values({
      provider_ref: s.providerRef,
      account: s.account,
      customer_ref: s.customerRef,
      period: s.period,
      units: s.units,
      status: s.status ?? "active",
      valid_until: s.validUntil,
      created_at: Date.now(),
    })
    .onConflict((oc) =>
      oc.column("provider_ref").doUpdateSet((eb) => ({
        units: eb.ref("excluded.units"),
        status: eb.ref("excluded.status"),
        valid_until: eb.ref("excluded.valid_until"),
        customer_ref: sql<string | null>`coalesce(excluded.customer_ref, subscription.customer_ref)`,
      })),
    )
    .execute();
  return (await subscriptionByRef(s.providerRef))!;
}

export async function subscriptionByRef(ref: string): Promise<Subscription | null> {
  const r = await (await db()).selectFrom("subscription").selectAll().where("provider_ref", "=", ref).executeTakeFirst();
  return r ? of(r) : null;
}

export const subscriptionsOf = async (account: string): Promise<Subscription[]> =>
  (await (await db()).selectFrom("subscription").selectAll().where("account", "=", account).orderBy("created_at").execute()).map(of);

export async function updateSubscription(ref: string, patch: Partial<Pick<Subscription, "units" | "status" | "validUntil">>): Promise<boolean> {
  const cur = await subscriptionByRef(ref);
  if (!cur) return false;
  const next = { ...cur, ...patch };
  await (
    await db()
  )
    .updateTable("subscription")
    .set({ units: next.units, status: next.status, valid_until: next.validUntil })
    .where("provider_ref", "=", ref)
    .execute();
  return true;
}

export const deleteSubscriptionsOf = async (account: string): Promise<void> =>
  void (await (await db()).deleteFrom("subscription").where("account", "=", account).execute());

// Paid for now: active, and its period not over (a lapsed period counts even if the provider's webhook for it never came).
export const isActive = (s: Subscription, now = Date.now()): boolean => s.status === "active" && (s.validUntil === null || s.validUntil > now);

export const activeUnits = async (account: string, now = Date.now()): Promise<number> =>
  (await subscriptionsOf(account)).filter((s) => isActive(s, now)).reduce((n, s) => n + s.units, 0);

// For the operator's metrics: subscriptions paid for now, and those lapsed.
export async function subscriptionCounts(now = Date.now()): Promise<{ active: number; lapsed: number; units: number }> {
  const rows = (await (await db()).selectFrom("subscription").selectAll().execute()).map(of);
  const active = rows.filter((s) => isActive(s, now));
  return { active: active.length, lapsed: rows.length - active.length, units: active.reduce((n, s) => n + s.units, 0) };
}
