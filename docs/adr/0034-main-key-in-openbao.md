---
status: accepted
date: 2026-10-18
decision-makers: Marcel Bruckner
---

# The main key in OpenBao, with no data key kept

## Context and Problem Statement

With ADR 0033 the main key that wraps every feed's data key is in notefeed's environment (`NOTEFEED_ENCRYPTION_KEY`), so a snapshot of the hosted service's server holds it, and nothing records who used it. How can the main key stay off the server, with every use of it on record and a way to make old backups unreadable (issue #215)?

## Considered Options

* The local key, as in ADR 0033.
* A cloud provider's key service.
* OpenBao's Transit engine (Vault-compatible), on our own monitoring server, keeping unwrapped data keys in memory.
* OpenBao's Transit engine, keeping no data key past the request that unwrapped it (chosen).

## Decision Outcome

Chosen: OpenBao Transit as a second `KeyWrapper`, with `NOTEFEED_KMS=openbao`; the local key stays the default.

* **The main key never leaves OpenBao.** notefeed sends data keys to wrap and wrapped ones to unwrap. The Transit key is derived, and the context sent is the one the local key binds to (`feed:<fingerprint>`, `keyring:<name>`), so a wrapped key moved to another feed does not open.
* **AppRole.** A role id and a secret id from the environment, bound to the private network; notefeed renews its short-lived token and logs in again after a 403. Rotating the credential is a new secret id, a restart, and destroying the old one.
* **No data key is kept** past the request that unwrapped it (within one request, once per feed), so OpenBao's audit log has an entry for every access to a feed. The keyring's fingerprint key stays in memory, as with the local key.
* **Unreachable is maintenance.** No answer, a timeout or a 5xx (sealed included) is `KeyServiceUnavailableError`: a maintenance page, and `503` with `Retry-After` and the code `unavailable` from the API. notefeed starts anyway and tries again with every request; `/health` has a `keys` check. The error is recognised by its digest, not its class, since Next may bundle a module once per route.
* **Batches.** Calls made together (a feed list, the re-wrap at start) go as one Transit batch per operation; a failed item fails only its caller.
* **Key versions are in the key id** (`openbao:<key>:v<n>`). After a rotation the next start re-wraps everything still on an older version with Transit's `rewrap`, the way a changed local key is re-wrapped (ADR 0033), and logs it. Retiring a version (`min_decryption_version`) stays a manual step in OpenBao; a database that still needs a retired version does not start.
* **Moving from the local key** is one start with the local key in `NOTEFEED_ENCRYPTION_OLD_KEYS`.

### Consequences

* Good, because a copy of the notefeed server, its environment included, holds no key that opens the data.
* Good, because every access to a feed's key is in OpenBao's audit log, and the credential can be revoked without touching the data.
* Good, because retiring a key version makes every backup wrapped only by it unreadable, after a leak.
* Bad, because while OpenBao is down every feed is down: there is no cache to fall back on. A short-lived cache would trade audit entries for availability, and is its own decision.
* Bad, because every request that opens a feed costs a round trip to OpenBao over the private network.
* Bad, because OpenBao is one more service to run, unseal, back up and monitor, and losing its key loses the data.
* Bad, because retiring a key version before the re-wrap, or while old backups are still wanted, loses data for good.
