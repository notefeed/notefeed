# Sign-in and sender

!!! info "notefeed is private by default"
    notefeed stores nothing about a person: no accounts, no profiles. Sign-in is **opt-in**, switched on only by the `NOTEFEED_OIDC_*` variables (see [Setup](setup.md)).

With sign-in on, people log in through your own OpenID Connect provider (Authentik, Keycloak, Google and the like, one or several) instead of sharing the instance password, and the notes they post carry their name as a **sender**. Read links, RSS, feed passwords and scripts work as before. You want it when a team shares one instance and wants to see who posted what, or when each person should authorise [MCP](../../integrations/mcp.md) clients with their own account. A single person, or scripts, need nothing from it.

## The sender

The sender is one line in the note's `---` header, the first non-empty claim of `NOTEFEED_OIDC_SENDER_CLAIM` (by default the `name`, else the `email`), and nothing else is stored about the person: no user table, no session list. The sign-in itself is a signed cookie in their browser, valid for 7 days.

The sender shows on the feed page, in the read-only view, in RSS as `<dc:creator>` and in the API as `sender`. A feed's **Show who posted** setting (`show_sender` in the [settings API](../../using/feeds.md#feed-settings-in-the-api)) hides it from readers; the feed page behind your password still shows it.

!!! warning "A copy can't be recalled"
    A note already fetched by an RSS reader keeps the sender it had. Turning the setting off hides it from now on, nothing more.

## Scripts and passwords

`NOTEFEED_PASSWORD` keeps working as a bearer token, and a note posted with it has no sender. Sign-in alone locks the instance to signed-in people, so set a password as well if scripts need to post.

## MCP

The OAuth authorize page that MCP clients open has a **Sign in with** button for each provider next to the password field. A client authorised that way posts with the person's sender.

## Removing a person

Take them off the allow-list and restart: they can no longer sign in, and what they already signed in with runs out within 7 days. To sign everyone out at once, change `NOTEFEED_SECRET`. Their notes keep the `sender` line until you delete the notes or edit it out of the files.

## Privacy page and imprint

A sender name or e-mail address is personal data, and as the operator you are its controller. Before you switch sign-in on, make your [privacy page](../legal-pages.md) say that notes carry the signed-in person's name or address, that it is shown on the public read link and in RSS unless the feed hides it, and how a person can have it removed.
