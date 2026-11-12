#!/bin/sh
# The iPhone Shortcut (shortcut/source.ts, #334). `build` writes the unsigned property list to .shortcut-build/; `sign` (macOS only)
# also converts and signs it into public/shortcuts/notefeed.shortcut (iOS names it after the file), which iOS imports, and only then
# records the source's hash next to it. Commit public/shortcuts/ after signing.
set -e
cd "$(dirname "$0")/.."

# Only the build test runs here: the "is it signed?" test can't pass before signing.
UPDATE_SHORTCUT=1 npx vitest run shortcut/source.test.ts -t "builds into a property list" --silent >/dev/null
[ "$1" = "sign" ] || exit 0

if [ "$(uname)" != "Darwin" ] || ! command -v shortcuts >/dev/null; then
  echo "Signing needs a Mac with the shortcuts command (macOS 12 or later), signed into iCloud with Shortcuts sync on." >&2
  exit 1
fi
mkdir -p public/shortcuts
plutil -convert binary1 -o .shortcut-build/notefeed.unsigned.shortcut .shortcut-build/notefeed.plist
shortcuts sign --mode anyone --input .shortcut-build/notefeed.unsigned.shortcut --output public/shortcuts/notefeed.shortcut
SIGNED_SHORTCUT=1 npx vitest run shortcut/source.test.ts -t "builds into a property list" --silent >/dev/null
# Now the whole file must pass, the signature check included.
npx vitest run shortcut/source.test.ts --silent >/dev/null
echo "Signed: public/shortcuts/notefeed.shortcut. Commit public/shortcuts/."
