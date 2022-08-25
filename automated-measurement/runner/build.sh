#!/usr/bin/env sh
set -ex
cd -- "$(dirname -- "$0")"

esbuild --platform=node --target=node16 --bundle --outdir=. \
  --external:playwright main.ts plans/*.ts "$@"

adm s3 resource-upload main.js plans/*.js
