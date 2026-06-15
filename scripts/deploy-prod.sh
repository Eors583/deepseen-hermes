#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose v2 is required" >&2
  exit 1
fi

if [ ! -f .env.prod ]; then
  cp .env.prod.example .env.prod
  echo "Created .env.prod from .env.prod.example"
  echo "Review .env.prod before exposing the service publicly."
fi

docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps

echo
echo "Hermes production web is served by the hermes-web Nginx container."
echo "It is listening on the port configured by HERMES_WEB_PORT (default 9119)."
echo "Open it, register the first account, then enter the DeepSeen API Key in Settings > Models."
