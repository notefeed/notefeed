---
status: accepted
date: 2026-10-18
decision-makers: Marcel Bruckner
---

# Encryption at rest inside notefeed, with a data key per feed

## Context and Problem Statement

Everything an instance stores was readable by whoever got a copy: the PostgreSQL data, the image files, the dumps and image copies on the same disk, the licenses file and the server snapshots. The database and the images are expected to leave the hosted service's server, to a Postgres host and a hosted S3, possibly sharded, so each must be safe wherever it runs. Feed names and read ids are how one gets into a feed (ADR 0001), so a copy that shows them is as bad as one that shows the notes. How should notefeed encrypt what it stores (issue #212)?

## Considered Options

* Disk or volume encryption on the server.
* The database's or the object store's own encryption.
* Encryption inside notefeed with one key for everything.
* Encryption inside notefeed, envelope style: a data key per feed, wrapped by one main key (chosen).

## Decision Outcome

Chosen: envelope encryption inside notefeed, optional, on the database backends.

* **Inside notefeed**, before a value reaches the database or the image store: the hosts only ever see ciphertext, wherever they are. Disk encryption stops protecting the data once it lives on another host; a provider's own encryption leaves the provider able to read it.
* **A data key per feed.** A feed's notes, images, metadata, settings and password hash are sealed with AES-256-GCM under its own 32-byte key, bound to their place by associated data (`note:<id>:content`, `feed:settings`, …), so a value moved to another row does not open. The data key is in the feed's row, wrapped by the main key (`NOTEFEED_ENCRYPTION_KEY`), with the main key's id beside it.
* **Fingerprints for lookups.** Names, read ids and the licenses' provider references are stored as HMAC-SHA256 fingerprints under a random fingerprint key per database, itself wrapped by the main key; the values the code needs back are sealed beside them. Tombstones hold fingerprints only. Takedowns work unchanged: a report carries a read id, never the name (ADR 0027).
* **Changing the main key is a re-wrap.** One start with the new key and the old one in `NOTEFEED_ENCRYPTION_OLD_KEYS` wraps the data keys and fingerprint keys again, in one transaction; no note or image is touched, so it takes seconds at any size. Fingerprints do not change.
* **Turning it on is gradual.** At start, plain feeds and tombstones are converted in one transaction (PostgreSQL holds an advisory lock, so containers starting together convert once). Plain notes keep reading as they are, marked by `notes.sealed`, and `POST /api/operator/reseal` encrypts them in batches while notefeed serves.
* **Refused, never guessed.** An encrypted database without the main key, or with keys wrapped by a key notefeed does not have, does not start. A value that does not open is an error, never empty.
* **Wrapping behind one interface** (`KeyWrapper`): the local main key now, a key service such as OpenBao later (#215).
* **Not the file system backend**: its folders and files are meant to be read and edited by hand (ADR 0017, 0018); disk encryption is the answer there.

### Consequences

* Good, because a stolen database, dump, bucket or snapshot shows neither the notes nor a way into a feed.
* Good, because the main key can be changed after a leak in one restart, however much data an instance holds.
* Good, because a feed's data key can later be wrapped a second way, by something only its owner has, which is the way to client-side encryption (#213).
* Bad, because losing the main key loses the data, and the operator must keep it apart from the backups.
* Bad, because while notefeed runs it holds the key: this does not protect against someone on the running server, or against the operator (#213).
* Bad, because the database can no longer search or sort by name or content; notefeed does it, after decrypting (search within a feed stays possible that way).
* Bad, because every container must restart together on a key change.
