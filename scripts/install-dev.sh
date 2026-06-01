#!/usr/bin/env bash
set -euo pipefail

npm install
npm run build
npm pack

cat <<'MSG'
Built the plugin package.
Install the generated .tgz in Tabby via Settings → Plugins → Install from file,
or use Tabby's documented local plugin development flow if working inside the Tabby monorepo.
MSG
