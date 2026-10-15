---
status: accepted
date: 2026-10-15
decision-makers: Marcel Bruckner
---

# notefeed stays outside the EU Cyber Resilience Act, and what keeps it there

## Context and Problem Statement

Issue #42 asked, before the first paid license (ADR 0029), whether the Cyber Resilience Act (Regulation (EU) 2024/2847, CRA) applies to notefeed once the same software is given away to self-host and sold as a hosted service on notefeed.me. Recital 18 counts free and open-source software as supplied in a commercial activity when its manufacturer monetises it, for instance "by providing a software platform through which the manufacturer monetises other services" (recital 15). If that covered "free to self-host, paid when hosted", notefeed would be a product under the CRA from the first paying customer on: reporting actively exploited vulnerabilities to ENISA within 24 hours (a duty since 2026-09-11), and from 2027-12-11 a risk assessment, SBOM, declared support period, technical documentation and CE self-assessment. Until this was answered, the project assumed the CRA applied.

The Commission's guidance on the CRA's scope was adopted on 2026-07-27 as the Annex to Decision C(2026) 5252 final. It is not binding, but it is the Commission's own reading and the most specific text there is. This ADR records what it says about notefeed, so that the question is not reopened each time the question comes up, and what must stay true for the answer to hold.

## Considered Options

* **Treat notefeed as a CRA product** and take on the manufacturer's duties for the self-hosted image.
* **Treat notefeed as outside the CRA**, on the Commission's guidance, and keep the facts that put it there. Chosen.
* **Ask the BSI's helpdesk for small manufacturers** before deciding.

## Decision Outcome

Chosen option: "outside the CRA", because the guidance answers each part of the question directly. Points and examples below are from the Annex to C(2026) 5252 final.

1. **notefeed.me is not a product with digital elements.** Example 5: "a web application accessed by the user exclusively through a web browser is not a product with digital elements. Unless it supports the functionality of a product with digital elements, it does not fall within the scope of the CRA." The installed web app (manifest, share target) is still a browser application. Hosted services are a matter for NIS 2 (point 183), whose size thresholds notefeed.me does not reach.
2. **The free, self-hosted version is not placed on the market.** Point 52, on a free and a paid version with the same codebase: they "are different products: the paid version is monetised in some way ... The version provided for free (or community version) is not monetised and therefore is not considered to be placed on the market for the purposes of the CRA." Point 56: "Where the FOSS can be downloaded and installed freely, and users can optionally choose to purchase professional services separately, that FOSS is not considered to be placed on the market." The image, the client packages (`packages/js`, `packages/python`) and the MCP server are free, nothing in them is gated, and no price or donation is asked for them (point 42, recital 18: FOSS "not monetised by their manufacturers" is not a commercial activity).
3. **The publisher is a natural person, so not an open-source software steward.** Point 53: "If the entity is a natural person, the version provided for free (the community version) is not within the scope of the CRA." Steward duties (Article 24) exist for legal persons only.
4. **The self-hosted copy is not a platform through which notefeed.me earns money.** This is the one way the free version could be placed on the market: point 54 and Examples 14 and 15 (a free marketplace app earning commissions, a free VPN app selling extra servers) count FOSS as commercial when the publisher "provides the software through which it monetises other products with digital elements or services". notefeed stays clear of this because, by ADR 0029, licenses exist only where the operator configures a payment provider; a self-hosted instance has none, the license code is inert, and nothing in it sells anything of notefeed.me's. The one who monetises a self-hosted instance, if anyone, is its operator, not the publisher.

A BSI enquiry was not made: the guidance is specific enough that an enquiry would get the same points back.

### Consequences

* Good: no ENISA reporting duty, no declared support period, no technical documentation or CE self-assessment for the image or the packages. The security policy, the SBOM per release and the vulnerability check (#176) stay, as good practice rather than a legal duty.
* Good: the "assume it applies" note on #42 is closed.
* **Constraint, from point 4:** nothing of notefeed.me's may ever be sold, advertised or upsold through the software itself. No "get hosting at notefeed.me" link, no licence purchase, no telemetry or sign-up as a condition of use, in the image, the packages or the MCP server. A self-hosted instance must not be able to buy anything from the publisher. Selling stays operator-only and out of the public docs (ADR 0029).
* **Constraint, from point 2:** the image and the packages stay free, with no gated edition and no paid support bundled with access to them. Paid consultancy sold separately would be fine (point 55, Example 18); a paid "enterprise image" would not (point 57, Example 17).
* **Constraint, from point 1:** notefeed.me stays a browser application. A native app (#149) that is sold or that carries the paid service would be a product with digital elements, and notefeed.me its remote data processing; that would reopen this ADR.
* **Constraint, from point 3:** if the publisher becomes a legal person (a company runs notefeed.me), it becomes a steward for the free version: a cybersecurity policy, cooperation with market surveillance authorities and vulnerability reporting under Article 24. Lighter than a manufacturer's duties, and no fines, but a duty.
* This is a reading of non-binding guidance by a non-lawyer, recorded with its sources so it can be checked: the Annex to C(2026) 5252 final, section 3 (points 40 to 89) and Example 5 in section 2.
