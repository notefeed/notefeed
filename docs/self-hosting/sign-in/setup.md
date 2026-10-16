# Sign-in setup

## Setup

Sign-in is on only when all four of these are set:

| Variable | Meaning |
|---|---|
| `NOTEFEED_OIDC_ISSUER` | The provider's issuer URL. notefeed reads `<issuer>/.well-known/openid-configuration` for the rest. |
| `NOTEFEED_OIDC_CLIENT_ID`, `NOTEFEED_OIDC_CLIENT_SECRET` | What the provider gave notefeed. |
| `NOTEFEED_OIDC_ALLOW` | Who may sign in: comma-separated addresses (`ann@example.com`), domains (`@example.com`) or `*` for anyone the provider authenticates. Matching by address needs the provider to report it as verified. |
| `NOTEFEED_OIDC_SENDER_CLAIM` | Optional, default `name,email`: the id_token claims tried in order for the sender. |
| `NOTEFEED_OIDC_LABEL` | Optional: the text after **Sign in with** on the button, else the issuer's host. |

You also need `PUBLIC_URL`, because the redirect URI is `<PUBLIC_URL>/api/oidc/callback`, and `NOTEFEED_SECRET`. Register that redirect URI with the provider, exactly, with no trailing slash.

```yaml
environment:
  PUBLIC_URL: https://notes.example.com
  NOTEFEED_SECRET: ${NOTEFEED_SECRET}
  NOTEFEED_OIDC_ISSUER: https://authentik.example.com/application/o/notefeed/
  NOTEFEED_OIDC_CLIENT_ID: ${NOTEFEED_OIDC_CLIENT_ID}
  NOTEFEED_OIDC_CLIENT_SECRET: ${NOTEFEED_OIDC_CLIENT_SECRET}
  NOTEFEED_OIDC_ALLOW: "@example.com,guest@example.org"
```

### Example: Authentik

1. Create an **OAuth2/OpenID provider**: client type confidential, redirect URI `https://notes.example.com/api/oidc/callback`, scopes `openid`, `profile` and `email`.
2. Create an **application** that uses it, with the slug `notefeed`.
3. Copy the client id and secret, and set the issuer to the application's OpenID configuration issuer, `https://authentik.example.com/application/o/notefeed/`.

## URLs and what the provider needs

The provider has to support the **authorization code flow with PKCE** for a confidential client, client authentication **in the token request body** (`client_secret_post`; switch a client that defaults to `client_secret_basic`), the scopes `openid profile email`, and an `id_token` that carries the sender claim and, for an allow-list of addresses, `email` and `email_verified`. notefeed reads claims from the `id_token` only and never calls the user-info endpoint.

Two details trip people up: `NOTEFEED_OIDC_ISSUER` must equal the `issuer` in the discovery document (only a trailing slash may differ), and the redirect URI is built from `PUBLIC_URL`, so without it behind a proxy the provider rejects the sign-in.

## Several providers

Each further provider is its own set of variables with a name of your choosing, capitals, digits and underscores: `NOTEFEED_OIDC_<NAME>_ISSUER`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_ALLOW`, and optionally `_SENDER_CLAIM` and `_LABEL`. The unprefixed variables are one more provider, so the name `DEFAULT` is reserved. A provider with one of its four variables missing is left out, and the others still work. Every provider has its own allow-list, and all share the one redirect URI.

```yaml
environment:
  NOTEFEED_OIDC_WORK_ISSUER: https://authentik.example.com/application/o/notefeed/
  NOTEFEED_OIDC_WORK_CLIENT_ID: ${NOTEFEED_OIDC_WORK_CLIENT_ID}
  NOTEFEED_OIDC_WORK_CLIENT_SECRET: ${NOTEFEED_OIDC_WORK_CLIENT_SECRET}
  NOTEFEED_OIDC_WORK_ALLOW: "@example.com"
  NOTEFEED_OIDC_WORK_LABEL: Example Corp
  NOTEFEED_OIDC_GUESTS_ISSUER: https://accounts.google.com
  NOTEFEED_OIDC_GUESTS_CLIENT_ID: ${NOTEFEED_OIDC_GUESTS_CLIENT_ID}
  NOTEFEED_OIDC_GUESTS_CLIENT_SECRET: ${NOTEFEED_OIDC_GUESTS_CLIENT_SECRET}
  NOTEFEED_OIDC_GUESTS_ALLOW: "guest@example.org"
```

Any OpenID Connect provider works; the usual issuer URLs, with the discovery document as the authority:

| Provider | Issuer | Notes |
|---|---|---|
| Authentik | `https://authentik.example.com/application/o/<slug>/` | See the example above. |
| Keycloak | `https://keycloak.example.com/realms/<realm>` | An OpenID Connect client with **Client authentication** on. |
| Authelia | `https://auth.example.com` | Set the client's `token_endpoint_auth_method` to `client_secret_post`. |
| Google | `https://accounts.google.com` | An OAuth client of type **Web application**. Use an address or domain allow-list, not `*`. |
| Microsoft Entra ID | `https://login.microsoftonline.com/<tenant-id>/v2.0` | May leave `email_verified` out of the `id_token`: then restrict the app in Entra, set the allow-list to `*` and use `preferred_username` as the sender claim. |

## Check that it works

1. `curl -s <issuer>/.well-known/openid-configuration | jq -r .issuer` must print what you set in `NOTEFEED_OIDC_ISSUER`.
2. Restart notefeed and open `/login`: there is a **Sign in with** button per provider. One missing means one of that provider's four variables is empty.
3. Sign in, post a note from the web UI: it shows **by** and your name next to the time.

## Troubleshooting

Every failed sign-in shows the same message, so read the log: `docker compose logs notefeed | grep '"component":"oidc"'`. The line's `msg` names the step that failed, with the provider, the HTTP status or a short error code, never a secret, token or name. To tell an allow-list problem from a provider problem, set the allow-list to `*` for a moment.

| `msg` | Fix |
|---|---|
| `discovery failed` | Open `<issuer>/.well-known/openid-configuration` from the notefeed container: a 404 is a wrong issuer path, a connection or certificate error is DNS, a firewall or a certificate between notefeed and the provider. |
| `issuer does not match the discovery document` | Copy the document's `issuer` into `NOTEFEED_OIDC_ISSUER`. |
| `token request rejected` | `invalid_client`: wrong id or secret, or the provider expects `client_secret_basic`. `invalid_grant`: the redirect URI or PKCE didn't match. |
| `token response has no id_token` | The client must request the `openid` scope and be an OpenID Connect client, not plain OAuth 2. |
| `id_token invalid` | `check` names what failed: `iss`, `aud`, `exp` (check the clocks) or `nonce`. |
| `person not on the allow-list`, `address needs a verified email` | Add the address or domain, or have the provider include `email` and `email_verified`. |
| `no sender claim in the id_token` | Add the `profile` and `email` scopes at the provider, or set `NOTEFEED_OIDC_SENDER_CLAIM`. |
| `state mismatch or missing sign-in cookie` | The sign-in took over 10 minutes or the browser blocks cookies. Try again. |

A provider's error page before you return means the registered redirect URI differs from `<PUBLIC_URL>/api/oidc/callback`. Signed out after a while is expected: a sign-in lasts 7 days, and a changed `NOTEFEED_PASSWORD` or `NOTEFEED_SECRET` signs everyone out. Failed sign-ins count toward the [rate limit](../limits.md).
