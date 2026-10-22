#!/usr/bin/env bash
# Prints the aethercode-secrets Secret manifest for a new cluster (the Kubernetes
# counterpart of deploy/single-server/setup.sh). Nothing is written to disk.
#   ./generate-secrets.sh aethercode | kubectl create -f -
# `kubectl create` fails if the Secret exists, so a re-run never rotates keys by accident.
# Usage: ./generate-secrets.sh <namespace> [secret name]
set -euo pipefail
namespace="${1:-}"
name="${2:-aethercode-secrets}"
if [[ -z "$namespace" ]]; then
  echo "usage: ./generate-secrets.sh <namespace> [secret name]" >&2
  exit 1
fi
umask 077

hex() { openssl rand -hex 24; }
b64() { openssl rand -base64 "$1" | tr -d '\n'; }
uuid() { cat /proc/sys/kernel/random/uuid; }

key_der="$(mktemp)"
trap 'rm -f "$key_der"' EXIT
openssl genpkey -algorithm ed25519 -outform DER -out "$key_der"
identity_seed="$(tail -c 32 "$key_der" | base64 -w0)"
identity_public="$(openssl pkey -inform DER -in "$key_der" -pubout -outform DER | tail -c 32 | base64 -w0)"
identity_key_id="$(uuid)"

keyring="["
for audience in aether_identity aether_tenant aether_users aether_qbank aether_assessment \
                aether_submission aether_seb aether_notification aether_analytics; do
  keyring+="{\"audience\":\"${audience}\",\"key_id\":\"$(uuid)\",\"secret_base64\":\"$(b64 32)\"},"
done
keyring="${keyring%,}]"

# JSON values are written as single-quoted YAML scalars; none contain a quote.
echo "apiVersion: v1"
echo "kind: Secret"
echo "metadata:"
echo "  name: ${name}"
echo "  namespace: ${namespace}"
echo "  labels: {app.kubernetes.io/part-of: aethercode}"
echo "type: Opaque"
echo "stringData:"
echo "  POSTGRES_SUPERUSER_PASSWORD: $(hex)"
for db in IDENTITY TENANT USERS QBANK ASSESSMENT SUBMISSION SEB NOTIFICATION ANALYTICS JUDGE; do
  echo "  ${db}_DB_PASSWORD: $(hex)"
done
echo "  JUDGE_RABBITMQ_PASSWORD: $(hex)"
echo "  MINIO_ROOT_USER: aethercode"
echo "  MINIO_ROOT_PASSWORD: $(hex)"
echo "  IDENTITY_ACCESS_TOKEN_KEY_ID: ${identity_key_id}"
echo "  IDENTITY_ACCESS_TOKEN_PRIVATE_KEY_BASE64: ${identity_seed}"
echo "  IDENTITY_ASSERTION_PUBLIC_KEYS: '{\"${identity_key_id}\":\"${identity_public}\"}'"
echo "  IDENTITY_DELIVERY_TOKEN_HMAC_KEY_BASE64: $(b64 32)"
echo "  IDENTITY_MFA_KEY_REFERENCE: mfa-1"
echo "  IDENTITY_MFA_MASTER_KEYS_JSON: '{\"mfa-1\":\"$(b64 32)\"}'"
echo "  PLATFORM_KMS_LOCAL_KEY: $(b64 32)"
echo "  SEB_LAUNCH_PASSWORD: $(hex)"
echo "  AUTHZ_CAPABILITY_KEYS: '${keyring}'"
