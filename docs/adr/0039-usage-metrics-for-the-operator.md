---
status: accepted
date: 2026-10-25
decision-makers: Marcel Bruckner
---

# Usage metrics for the operator: counts over all feeds, counted every 5 minutes

## Context and Problem Statement

`/metrics` (ADR 0022) says how fast the instance is, not how it is used. The operator of the hosted service wants one dashboard for how many feeds, notes and images there are, how much the images take, how many licenses are paid, which free feeds are about to drop notes, and how all of that grows. Grafana and Prometheus already scrape `/metrics`. The numbers must not become a view of anyone's feed, and counting must not cost a pass over every note on every scrape.

## Considered Options

* Usage gauges in `/metrics`, counted through the storage interface (`Storage.usage`) at most every 5 minutes, plus counters for the events behind them.
* An operator endpoint (`/api/operator/stats`) returning JSON, polled by a Grafana JSON data source.
* Queries by the monitoring server straight against PostgreSQL (`postgres_exporter` custom queries).

## Decision Outcome

Chosen option: the first. It works on every storage backend (file system, SQLite, PostgreSQL), needs no new data source or database access for the monitoring server, and Prometheus keeps the history for trends.

What is counted, and what never is: this is a promise to whoever runs or uses an instance.

* **Counted**: totals over all feeds. Feeds, protected feeds, feeds with a read link, feeds with a note written in the last 1, 7 and 30 days; stored notes and their bytes by kind; with licensing on, feeds near, at or over the free tier's cap, and licenses by state (active, unattached, lapsed); on a database its size and, on PostgreSQL, its connections. Events: feeds created and deleted, notes posted, edited and deleted, license events.
* **Never**: a feed name, read id, note text or title, tag, sender, license key or its hash, provider reference, address, or anything per feed. Labels are closed sets (`kind`, `reason`, `state`, `within`, `notes`, `protected`, `what`, `event`). There is no metric for one feed, and no metric a request can make grow by series.
* **No content is read.** `Storage.usage` returns flags and sizes per feed without names: on a database it is two grouped queries that join on the stored `name` column (a fingerprint when encrypted), so no data key is unwrapped and the key service (ADR 0034) is not asked once per feed; on the file system it is a listing and an `lstat` per note.
* **Cost.** A count runs when a scrape finds the last one older than 5 minutes, one at a time; that scrape and all others answer with the last count, only the very first scrape after a start waits. A failed count is logged and the gauges keep the last values. `notefeed_usage_count_duration_seconds` shows what a count costs.
* **Activity** is when a note's content was last written; reading a feed is not activity (the read path stays free of writes and of tracking).
* **Licenses are counted without their period** (month or year): the license store does not hold it, and storing it is a change to the billing records of its own.

### Consequences

* Good, because the operator sees growth and the free tier's pressure without anyone's content or identifiers leaving the instance.
* Good, because the same metrics work on an own instance with file storage.
* Bad, because the gauges are up to 5 minutes old, and a feed's activity misses metadata-only edits.
* Bad, because on the file system a count is a pass over every note's file: large instances pay it every 5 minutes while scraped.
* Bad, because counters start at 0 on restart and count per process; Prometheus' `increase()` covers the first, one process per instance the second.
