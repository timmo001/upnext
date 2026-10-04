#!/usr/bin/env bash

# Runs the CLI from source, for the development panel.
set -euo pipefail

repo_dir="$(realpath "$(dirname "${BASH_SOURCE[0]}")/../..")"
exec mise -C "$repo_dir" exec -- bun run "$repo_dir/src/index.ts" "$@"
