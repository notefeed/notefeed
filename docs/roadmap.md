---
hide:
  - toc
---

# Where notefeed is going { .nf-center }

notefeed started as one feed of markdown notes posted over HTTP and read back as RSS. It is becoming a place where anyone, a person, a script or an AI assistant, keeps feeds of notes and pictures without an account, on notefeed.me or on their own server. This page says what is planned and why, inside [what notefeed stands for](values.md), and what has shipped.
{: .nf-center .nf-lead }

Every step makes publishing easier without making anyone known: it works without an account, through the API and MCP as well as the web UI, and it keeps a note in the one feed it belongs to. Planned steps have no dates, only now, next or later; shipped steps carry the day they shipped. A step that is dropped leaves the timeline, with the reason in its issue.

<!-- roadmap -->

## Parked

Considered and wanted, not needed yet: sharing the rate limits and metrics between several notefeed processes ([#129](https://github.com/notefeed/notefeed/issues/129)), until notefeed.me runs more than one.

## Decided against

Accounts, sign-up or a login that reaches a feed ([V1](values.md#v1)); reader counts, view statistics, a directory or search of feeds ([V3](values.md#v3)); comments stored under someone else's note, where a reply from one's own feed does the job ([V8](values.md#v8)); ads, or a free tier paid for with data ([V7](values.md#v7)); features only notefeed.me has ([V6](values.md#v6)).

## Keep it true

The timeline is rendered from [`docs/roadmap.yml`](https://github.com/notefeed/notefeed/blob/main/docs/roadmap.yml); on GitHub, read that file. Every step has an issue and names the value point it serves. Finish a step in the pull request that finishes it: set `status: done`, replace `when` with a `date`, add the link to its pull request, and move it to the top of the shipped entries. Change the file in the pull request that changes the plan.
