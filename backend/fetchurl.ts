// A file fetched from a public URL for a post (#422, ADR 0066): what an assistant without a shell gives in place of base64 or an
// upload. The server makes a request on a caller's behalf, so it must never reach what is not public: the address every request
// connects to is checked (the one DNS gave, connected to as checked, so a second lookup can't swap it: DNS rebinding), each redirect
// is a new request checked the same way, and only https on port 443 is fetched. The size is enforced while reading and the whole
// fetch has a deadline. No cookies or credentials are sent.
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpsRequest } from "node:https";
import { request as httpRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { BusyError, ImageTooLargeError, InvalidRequestError, NotefeedError } from "./errors";

const deny4 = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], // this network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const)
  deny4.addSubnet(net, bits, "ipv4");

// IPv6: only global unicast (2000::/3) is public, less the parts of it that lead elsewhere. Everything else is refused, which covers
// loopback, link-local, unique local, multicast, IPv4-mapped (::ffff:127.0.0.1) and NAT64 addresses.
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
const deny6 = new BlockList();
for (const [net, bits] of [
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
] as const)
  deny6.addSubnet(net, bits, "ipv6");

/** Whether `address` (an IP literal) is one the internet routes to the public: no private, loopback, link-local or reserved range. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !deny4.check(address, "ipv4");
  if (family === 6) return global6.check(address, "ipv6") && !deny6.check(address, "ipv6");
  return false;
}

export type Fetched = { body: Buffer; mediaType: string | undefined };

type Options = {
  maxBytes: number;
  /** The whole fetch, redirects included. */
  timeoutMs?: number;
  maxRedirects?: number;
  /** For tests only: which addresses may be reached, and plain http. */
  allow?: (address: string) => boolean;
  insecure?: boolean;
  lookup?: typeof dnsLookup;
};

const notReachable = (url: URL) => new InvalidRequestError(`source_url: ${url.host} is not a public address`);

// The DNS lookup every request uses: each address it gives must be public, and the request connects to the one checked.
function checkedLookup(allow: (a: string) => boolean, lookup: typeof dnsLookup, url: URL): LookupFunction {
  return (hostname, options, callback) =>
    lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      const list = addresses as unknown as LookupAddress[];
      if (!list.length || !list.every((a) => allow(a.address))) return callback(notReachable(url), "", 0);
      if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
      callback(null, list[0].address, list[0].family);
    });
}

let running = 0;
const MAX_RUNNING = 4;

/** The bytes at a public https URL, at most `maxBytes`, and the media type the server gave. Refuses what is not public. */
export async function fetchPublic(source: string, opts: Options): Promise<Fetched> {
  if (running >= MAX_RUNNING) throw new BusyError("too many files are being fetched, try again shortly");
  running++;
  const deadline = AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  try {
    let url = parse(source, opts);
    for (let hops = 0; ; hops++) {
      const res = await get(url, opts, deadline);
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (hops >= (opts.maxRedirects ?? 3)) throw new InvalidRequestError("source_url: too many redirects");
        url = parse(new URL(res.headers.location, url).toString(), opts);
        continue;
      }
      if (res.statusCode !== 200) {
        res.resume();
        throw new InvalidRequestError(`source_url: the site answered ${res.statusCode}`);
      }
      return { body: await read(res, opts.maxBytes, url), mediaType: res.headers["content-type"] };
    }
  } catch (e) {
    if (deadline.aborted) throw new InvalidRequestError("source_url: the site took too long to answer");
    if (e instanceof NotefeedError) throw e;
    // A network error (no such host, refused, reset, a bad certificate): its code, not its message, which may hold addresses.
    throw new InvalidRequestError(`source_url: the file could not be fetched (${(e as NodeJS.ErrnoException).code ?? "network error"})`);
  } finally {
    running--;
  }
}

function parse(source: string, opts: Options): URL {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new InvalidRequestError("source_url: not a URL");
  }
  if (url.protocol !== "https:" && !(opts.insecure && url.protocol === "http:")) throw new InvalidRequestError("source_url: only https URLs are fetched");
  if (url.username || url.password) throw new InvalidRequestError("source_url: a URL with a user name or password is not fetched");
  if (!opts.insecure && url.port !== "" && url.port !== "443") throw new InvalidRequestError("source_url: only the https port 443 is fetched");
  // An IP literal is never looked up, so it is checked here.
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (isIP(host) && !(opts.allow ?? isPublicAddress)(host)) throw notReachable(url);
  return url;
}

function get(url: URL, opts: Options, signal: AbortSignal): Promise<IncomingMessage> {
  const options: RequestOptions = {
    method: "GET",
    signal,
    lookup: checkedLookup(opts.allow ?? isPublicAddress, opts.lookup ?? dnsLookup, url),
    headers: { "User-Agent": "notefeed (fetching a file for a post)", Accept: "image/png, image/jpeg, image/gif, image/webp, text/markdown;q=0.9" },
    agent: false, // no pooled connection, which another lookup could have made
  };
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "http:" ? httpRequest : httpsRequest)(url, options, resolve);
    req.on("error", reject);
    req.end();
  });
}

function read(res: IncomingMessage, maxBytes: number, url: URL): Promise<Buffer> {
  const declared = Number(res.headers["content-length"]);
  if (declared > maxBytes) {
    res.destroy();
    return Promise.reject(new ImageTooLargeError(`source_url: the file at ${url.host} is larger than ${maxBytes} bytes`));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        res.destroy();
        reject(new ImageTooLargeError(`source_url: the file at ${url.host} is larger than ${maxBytes} bytes`));
      } else chunks.push(chunk);
    });
    res.on("end", () => resolve(Buffer.concat(chunks)));
    res.on("error", reject);
  });
}
