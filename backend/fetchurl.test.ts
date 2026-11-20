import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test } from "vitest";
import { fetchPublic, isPublicAddress } from "./fetchurl";

test("public addresses pass; private, loopback, link-local, reserved and mapped ones don't (#422)", () => {
  for (const a of ["93.184.215.14", "1.1.1.1", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e"]) expect(isPublicAddress(a), a).toBe(true);
  for (const a of [
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.1",
    "172.16.5.4",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::7f00:1",
    "2001:db8::1",
    "2002:7f00:1::1",
    "2001:0:4136:e378::1",
    "not an address",
  ])
    expect(isPublicAddress(a), a).toBe(false);
});

const PNG = Buffer.from("89504e470d0a1a0a", "hex");
let server: Server;
let port: number;
let calls = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    calls++;
    if (req.url === "/pic.png") return res.writeHead(200, { "Content-Type": "image/png" }).end(PNG);
    if (req.url === "/big") return res.writeHead(200, { "Content-Type": "image/png", "Content-Length": "1000" }).end(Buffer.alloc(1000));
    if (req.url === "/stream") {
      // no Content-Length: the size is only found while reading
      res.writeHead(200, { "Content-Type": "image/png" });
      for (let i = 0; i < 10; i++) res.write(Buffer.alloc(100));
      return res.end();
    }
    if (req.url === "/slow") return setTimeout(() => res.end("late"), 2000);
    if (req.url === "/to-other") return res.writeHead(302, { Location: `http://127.0.0.2:${port}/pic.png` }).end();
    if (req.url === "/to-self") return res.writeHead(301, { Location: "/pic.png" }).end();
    if (req.url === "/loop") return res.writeHead(302, { Location: "/loop" }).end();
    if (req.url === "/cookie") return res.writeHead(200).end(JSON.stringify(req.headers));
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

// The test server is on loopback, which the real check refuses: here only 127.0.0.1 counts as public, over plain http.
const opts = { maxBytes: 500, insecure: true, allow: (a: string) => a === "127.0.0.1" };
const at = (path: string) => `http://127.0.0.1:${port}${path}`;

test("a file is fetched with its media type, and the request carries no credentials", async () => {
  expect(await fetchPublic(at("/pic.png"), opts)).toEqual({ body: PNG, mediaType: "image/png" });
  const headers = JSON.parse((await fetchPublic(at("/cookie"), opts)).body.toString());
  expect(headers.cookie).toBeUndefined();
  expect(headers.authorization).toBeUndefined();
  expect(headers["user-agent"]).toMatch(/^notefeed/);
});

test("the size limit holds before reading (Content-Length) and while reading", async () => {
  await expect(fetchPublic(at("/big"), opts)).rejects.toThrow(/larger than 500 bytes/);
  await expect(fetchPublic(at("/stream"), opts)).rejects.toThrow(/larger than 500 bytes/);
});

test("a slow site is cut off", async () => {
  await expect(fetchPublic(at("/slow"), { ...opts, timeoutMs: 200 })).rejects.toThrow(/took too long/);
});

test("a redirect is followed and checked like the first request; a redirect to an address not public is refused", async () => {
  expect((await fetchPublic(at("/to-self"), opts)).body).toEqual(PNG);
  await expect(fetchPublic(at("/to-other"), opts)).rejects.toThrow(/127\.0\.0\.2.* is not a public address/);
  await expect(fetchPublic(at("/loop"), opts)).rejects.toThrow(/too many redirects/);
});

test("a host name is checked by the address it resolves to, the one connected to (DNS rebinding)", async () => {
  // localhost resolves to 127.0.0.1, allowed here; a name that resolves to a private address is refused before any connection.
  expect((await fetchPublic(`http://localhost:${port}/pic.png`, { ...opts, allow: (a) => a === "127.0.0.1" || a === "::1" })).body).toEqual(PNG);
  const before = calls;
  const evil = ((_h: string, _o: unknown, cb: (e: null, a: { address: string; family: number }[]) => void) =>
    cb(null, [{ address: "10.0.0.7", family: 4 }])) as never;
  await expect(fetchPublic(`http://evil.test:${port}/pic.png`, { ...opts, lookup: evil })).rejects.toThrow(/evil\.test.* is not a public address/);
  expect(calls).toBe(before);
});

test("the real rules: only https on port 443, no user in the URL, no private address, no IP literal that isn't public", async () => {
  const strict = { maxBytes: 500 };
  await expect(fetchPublic("http://example.com/a.png", strict)).rejects.toThrow(/only https/);
  await expect(fetchPublic("ftp://example.com/a.png", strict)).rejects.toThrow(/only https/);
  await expect(fetchPublic("https://example.com:8443/a.png", strict)).rejects.toThrow(/port 443/);
  await expect(fetchPublic("https://u:p@example.com/a.png", strict)).rejects.toThrow(/user name or password/);
  await expect(fetchPublic("not a url", strict)).rejects.toThrow(/not a URL/);
  for (const host of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "[::1]", "[::ffff:127.0.0.1]", "[fd00::1]"])
    await expect(fetchPublic(`https://${host}/a.png`, strict), host).rejects.toThrow(/is not a public address/);
  await expect(fetchPublic("https://localhost/a.png", strict)).rejects.toThrow(/is not a public address/);
});
