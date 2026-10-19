// The startup line and what is wrong with the configuration, logged once when the server starts
// (instrumentation.ts). Names of variables only, never their values.
import { config, LOG_LEVELS, type StorageKind } from "./config";
import { keyServiceDown } from "./errors";
import { reservedFeedProblems, RESERVED_FEEDS } from "./feeds";
import { licensePageProblem, pagesDirWarnings } from "./legal";
import { logger } from "./log";
import { missingVars, providers } from "./oidc/config";
import { licensingOn, openLicenses } from "./licensing";
import { storage } from "./storage";
import { KeyringError } from "./storage/sql/keyring";

type Fields = Record<string, unknown>;

// One of a provider's four variables: group 1 is its NAME, absent for the unprefixed set.
const PROVIDER_VAR = /^NOTEFEED_OIDC_(?:([A-Z0-9]+(?:_[A-Z0-9]+)*?)_)?(?:ISSUER|CLIENT_ID|CLIENT_SECRET|ALLOW)$/;

// A warning: component, msg, fields.
type Warning = [string, string, Fields];

// What to do about a reserved feed that already exists unprotected or under another read id.
export const reservedHint = (kind: StorageKind): string =>
  kind === "fs"
    ? "delete its folder in DATA_DIR and restart so it is recreated protected, with its read id equal to its name"
    : "delete the feed and restart so it is recreated protected, with its read id equal to its name";

// Settings notefeed no longer reads (ADR 0035), and what took their place: an upgraded instance keeps running, without its pages.
const REMOVED: Record<string, string> = {
  NOTEFEED_IMPRINT_FILE: "NOTEFEED_PAGES_DIR",
  NOTEFEED_PRIVACY_FILE: "NOTEFEED_PAGES_DIR",
  NOTEFEED_TERMS_FILE: "NOTEFEED_PAGES_DIR",
  NOTEFEED_NOTICE_FILE: "NOTEFEED_PAGES_DIR",
  NOTEFEED_LICENSE_PRICE: "the payment provider's products",
  NOTEFEED_LICENSE_PRICE_YEARLY: "the payment provider's products",
};

export function startupReport(env: NodeJS.ProcessEnv = process.env): { fields: Fields; warnings: Warning[] } {
  const warnings: Warning[] = [];
  // A provider some but not all of whose variables are set (empty counts as unset) stays off: say which are missing.
  const names = new Set(Object.entries(env).flatMap(([k, v]) => (v ? (PROVIDER_VAR.exec(k)?.slice(1, 2) ?? []) : []).map((n) => n ?? "")));
  for (const name of [...names].filter((n) => n !== "DEFAULT").sort()) {
    const missing = missingVars(name);
    if (missing.length > 0 && missing.length < 4) warnings.push(["startup", "sign-in provider configured partially; it stays off", { provider: name ? name.toLowerCase() : "default", missing }]);
  }
  const oidcProviders = providers().length;
  if (oidcProviders && !config.publicUrl()) warnings.push(["startup", "sign-in is on without PUBLIC_URL: the redirect URI comes from each request's Host header", {}]);
  const level = (env.NOTEFEED_LOG_LEVEL ?? "").trim().toLowerCase();
  if (level && level !== config.logLevel()) warnings.push(["startup", "NOTEFEED_LOG_LEVEL is not a level; using info", { accepted: [...LOG_LEVELS] }]);
  if (config.reservedFeeds().length && !config.reservedPassword()) warnings.push(["feeds", "reserved feeds are listed but have no password; they are not created", {}]);
  if (config.metrics() && !config.metricsToken()) warnings.push(["startup", "metrics are on without NOTEFEED_METRICS_TOKEN: /metrics is open to anyone who can reach the app", {}]);
  for (const [setting, replacedBy] of Object.entries(REMOVED)) if (env[setting]) warnings.push(["startup", "a setting is no longer read", { setting, replacedBy }]);
  if (config.supportEmailInvalid()) warnings.push(["startup", "NOTEFEED_SUPPORT_EMAIL is not an email address; there is no Support link", {}]);
  if (config.operatorTokenTooShort()) warnings.push(["startup", "NOTEFEED_OPERATOR_TOKEN is shorter than 32 bytes; the operator endpoints stay off", {}]);
  const fields = {
    node: process.version,
    storage: config.storage(),
    dataDir: config.dataDir(),
    passwordSet: config.password() !== "",
    oidcProviders,
    publicUrlSet: config.publicUrl() !== "",
    trustProxy: config.trustProxy(),
    maxFeeds: config.maxFeeds(),
    maxNotesPerFeed: config.maxNotesPerFeed(),
    maxImagesPerFeed: config.maxImagesPerFeed(),
    logLevel: config.logLevel(),
    logRequests: config.logRequests(),
    metrics: config.metrics(),
    pagesDirSet: config.pagesDir() !== "",
  };
  return { fields, warnings };
}

// A reserved name that was already an ordinary feed when it was listed: load() leaves such a feed as it is.
export async function reservedFeedWarnings(): Promise<Warning[]> {
  return (await reservedFeedProblems()).map(({ feed, problem }) => [
    "feeds",
    problem === "unprotected" ? "reserved feed exists but is not protected" : "reserved feed exists with another read id than its name",
    { feed, hint: reservedHint(config.storage()) },
  ]);
}

// A feed folder that predates a route name notefeed reserves (like `metrics`, which became the scrape route) can no longer be opened
// by name. The names are notefeed's own fixed ones, not a user's feed names, so they may be logged.
export async function reservedFolderWarnings(): Promise<Warning[]> {
  const feeds = (await storage().listFeedNames()).filter((n) => RESERVED_FEEDS.has(n)).sort();
  return feeds.length
    ? [["feeds", "a feed folder is named like one of notefeed's routes; it cannot be opened by name", { feeds, hint: "rename its folder in DATA_DIR to a name that is not reserved, and restart" }]]
    : [];
}

// Throws only for a wrong storage setting; any other failure here must not keep the server from starting.
// The folder of the operator's pages that is none, or a page in it that cannot be shown: the visitor would only see that it is missing.
export async function legalFileWarnings(): Promise<Warning[]> {
  return (await pagesDirWarnings()).map((w): Warning =>
    w.setting ? ["startup", "NOTEFEED_PAGES_DIR is not a readable folder; there are no pages", { setting: w.setting }] : ["startup", "a page's file in NOTEFEED_PAGES_DIR cannot be shown (not a file, or larger than 256 KiB)", { file: w.file }],
  );
}

// Selling licenses needs the license page's words: without them the page, and every way to buy, would be missing.
export async function requireLicensePage(): Promise<void> {
  if (!licensingOn()) return;
  const problem = await licensePageProblem();
  if (problem) throw new Error(`NOTEFEED_PAYMENT_PROVIDER needs a license page: ${problem}`);
}

export async function logStartup(): Promise<void> {
  config.validateStorage(); // a wrong storage setting keeps the server from starting; with a database the main key does too, below
  await requireLicensePage(); // so does selling licenses without a license.md
  const warn = (warnings: Warning[]) => warnings.forEach(([component, msg, f]) => logger(component).warn(f, msg));
  try {
    const { fields, warnings } = startupReport();
    logger("startup").info(fields, "notefeed started");
    warn(warnings);
    // The license store comes to the main key now too: a key change re-wraps it in this start, not at its first use.
    await openLicenses();
    warn(await legalFileWarnings());
    warn(await reservedFolderWarnings());
    warn(await reservedFeedWarnings()); // loads the feed index, which creates missing reserved feeds
  } catch (e) {
    // A database this main key cannot open (encryption at rest, issue #212) must not be served: every request would fail.
    if (e instanceof KeyringError) throw e;
    // The key service (#215) is down: each request tries again, and gets the maintenance page meanwhile.
    if (keyServiceDown(e)) return void logger("startup").warn("the key service is unreachable: serving the maintenance page until it answers");
    try {
      logger("startup").error({ err: e }, "startup report failed");
    } catch {}
  }
}
