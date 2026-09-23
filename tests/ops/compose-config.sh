#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

test -f compose.yaml
test -f apps/web/Dockerfile
test -f apps/worker/Dockerfile
test -f scripts/migrate.sh

if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  config_file="$(mktemp)"
  trap 'rm -f "$config_file"' EXIT
  docker compose --env-file .env.example config >"$config_file"
  CONFIG_FILE="$config_file" python3 <<'PY'
import os, yaml
with open(os.environ['CONFIG_FILE'], encoding='utf-8') as handle:
    config = yaml.safe_load(handle)
services = config['services']
assert set(('db', 'migrate', 'web', 'worker')) <= set(services)
assert services['web']['restart'] == 'unless-stopped'
assert services['worker']['restart'] == 'unless-stopped'
assert services['web']['depends_on']['migrate']['condition'] == 'service_completed_successfully'
assert services['worker']['depends_on']['migrate']['condition'] == 'service_completed_successfully'
assert any(item['type'] == 'volume' for item in services['db']['volumes'])
PY
else
  python3 <<'PY'
import yaml
with open('compose.yaml', encoding='utf-8') as handle:
    config = yaml.safe_load(handle)
services = config['services']
assert set(('db', 'migrate', 'web', 'worker')) <= set(services)
assert services['web']['restart'] == 'unless-stopped'
assert services['worker']['restart'] == 'unless-stopped'
assert services['web']['depends_on']['migrate']['condition'] == 'service_completed_successfully'
assert services['worker']['depends_on']['migrate']['condition'] == 'service_completed_successfully'
assert services['db']['volumes'][0].split(':', 1)[0] in config['volumes']
assert services['worker']['volumes'][0].split(':', 1)[0] in config['volumes']
assert config['networks']['backend']['internal'] is True
PY
  echo 'Docker unavailable; parsed Compose contract with PyYAML.'
fi

if grep -En '(password|secret|token):[[:space:]]+[^$]' compose.yaml; then
  echo 'compose.yaml contains an embedded secret-like value' >&2
  exit 1
fi
grep -F 'USER node' apps/web/Dockerfile >/dev/null
grep -F 'USER node' apps/worker/Dockerfile >/dev/null
grep -F 'postgresql-client' apps/worker/Dockerfile >/dev/null
grep -F 'node:22.20.0-' apps/web/Dockerfile >/dev/null
grep -F 'node:22.20.0-' apps/worker/Dockerfile >/dev/null

echo 'Compose deployment contract passed.'
