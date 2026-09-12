#!/usr/bin/env bash
set -euo pipefail

server_dir="$(cd "$(dirname "$0")/.." && pwd)"
cert_dir="$server_dir/certs"
ip="${1:-}"
if [[ -z "$ip" ]] && command -v ipconfig >/dev/null 2>&1; then
  ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
fi

san="DNS:localhost,IP:127.0.0.1"
if [[ -n "$ip" ]]; then san="$san,IP:$ip"; fi

mkdir -p "$cert_dir"
openssl req -x509 -newkey rsa:2048 -sha256 -nodes \
  -keyout "$cert_dir/key.pem" -out "$cert_dir/cert.pem" -days 30 \
  -subj "/CN=localhost" -addext "subjectAltName=$san"
chmod 600 "$cert_dir/key.pem"
echo "Wrote $cert_dir/key.pem and $cert_dir/cert.pem"
