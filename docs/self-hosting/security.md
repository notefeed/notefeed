# Security fixes and SBOM

## Which versions get fixes

Only the newest release. A security fix is a new release, and older versions are not patched. An instance on `:latest`, or on a `:X` or `:X.Y` tag that follows the newest release, gets the fix with the next pull; see [Upgrading](upgrading.md).

## Reporting a vulnerability

Privately, through [Report a vulnerability](https://github.com/notefeed/notefeed/security/advisories/new) on GitHub, not as a public issue. The [security policy](https://github.com/notefeed/notefeed/blob/main/SECURITY.md) has the details. Fixed vulnerabilities are listed under [Security advisories](https://github.com/notefeed/notefeed/security/advisories).

## What is in a release

Each [release](https://github.com/notefeed/notefeed/releases) has two SBOM files in CycloneDX JSON:

| File | Lists |
|---|---|
| `notefeed-X.Y.Z-npm.cdx.json` | the npm packages the server is built from, as `package-lock.json` resolves them, without the ones only tests and the build use |
| `notefeed-X.Y.Z-image.cdx.json` | what a scan finds in the `linux/amd64` image: the Alpine packages, Node.js and the npm packages that are files in the image |

The two overlap, and neither replaces the other: many npm packages are compiled into the server's bundle, where a scan of the image does not see them.

The image carries an SBOM and a build provenance attestation as well:

```sh
docker buildx imagetools inspect ghcr.io/notefeed/notefeed:latest --format '{{ json .SBOM }}'
docker buildx imagetools inspect ghcr.io/notefeed/notefeed:latest --format '{{ json .Provenance }}'
```

## Checking an instance yourself

Any scanner that reads CycloneDX takes the files above. To scan the image directly, for example with [Grype](https://github.com/anchore/grype):

```sh
grype ghcr.io/notefeed/notefeed:latest --only-fixed
```

The project runs the same scan every day, together with a check of the npm and Python dependencies, so a finding with a fix normally leads to a release.
