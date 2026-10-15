---
status: accepted
date: 2026-10-15
decision-makers: Marcel Bruckner
---

# Configuration stays in environment variables: no config file, no operator page that changes it

## Context and Problem Statement

An instance is configured only through environment variables (`backend/config.ts`, listed in `docs/self-hosting/configuration.md`), about fifty of them. Issue #189 asked whether a JSON configuration file should take their place or sit beside them, and whether an operator page in the web UI should show the configuration and change what can be changed at runtime, without a restart. The list is long and flat; several OIDC providers, S3 and the caps fit awkwardly into env names, and lists are comma-separated strings.

## Considered Options

* **Environment variables only**, as today. Chosen.
* **A JSON file** (`DATA_DIR/notefeed.json` or `NOTEFEED_CONFIG`), env over file over default, validated by one schema.
* **A JSON file and an operator page** that edits the runtime settings (caps, rate limit, title, notice, image uploads, log level) and writes them back to the file or the storage backend.

## Decision Outcome

Chosen option: "Environment variables only", because neither of the others makes running an instance easier, and the page makes running several of them worse.

* **A file adds nothing over env.** Self-hosters use Compose, where the variables already live in a file (`compose.yaml` or `.env`). A second format means a second place to look and precedence rules to learn and debug.
* **A fleet is configured by its deploy tooling.** Whether instances read env or JSON, the configuration has to be shipped to each of them; notefeed.me's Ansible templates `.env` today and would template a JSON file the same way. Same work, same result.
* **A page that changes configuration splits the source of truth.** A change made on one instance's page exists only there: instances drift apart, and the next deploy either overwrites the change or fights it. Configuration comes from one place, outside the instance, and is read-only inside it.
* **No new authenticated surface.** notefeed has no accounts (ADR 0014). A page that can change the instance password, caps and OIDC settings would be the most valuable thing on an instance to break into, for a convenience used a few times a year.
* **Live changes cost more than they look.** Reserved feeds are created at start-up, the logger's level is fixed when it is built, OIDC discovery is cached and the rate limiter is built once. Changing them live needs invalidation, a "restart needed" state and tests per setting.

### Consequences

* Good: one way to configure an instance, the same for one instance and for a fleet; existing setups and docs stay as they are.
* Good: no admin login, no stored configuration state, no config reload path to test.
* Bad: the awkward shapes stay: several OIDC providers as `NOTEFEED_OIDC_<NAME>_*`, lists as comma-separated strings. New settings should keep to the existing patterns rather than add new ones.
* Bad: changing a cap or the notice still needs a restart.
* What an instance actually runs with is read from the start-up log (`startupReport()` in `backend/startup.ts`), not from a page.
* Not decided here: a UI for the existing operator actions (takedown, image clean-up), which change data, not configuration; and `*_FILE` variables that read a secret from a file (Docker secrets), which keep env as the only source. Either needs its own issue.
