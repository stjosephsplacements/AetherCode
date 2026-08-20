#!/usr/bin/env bash
set -euo pipefail

namespace="${NAMESPACE:?set NAMESPACE to the Judge0 engine namespace}"
selector="${POD_SELECTOR:-app.kubernetes.io/part-of=judge-engine}"
runtime_class="${RUNTIME_CLASS:-gvisor}"

command -v kubectl >/dev/null
command -v jq >/dev/null

kubectl get runtimeclass "$runtime_class" >/dev/null
kubectl -n "$namespace" wait --for=condition=Ready pod -l "$selector" --timeout=10m

pod_json="$(kubectl -n "$namespace" get pods -l "$selector" -o json)"
if ! jq -e --arg runtime_class "$runtime_class" '
  (.items | length) >= 6 and
  all(.items[];
    .spec.runtimeClassName == $runtime_class and
    (.spec.hostNetwork // false | not) and
    (.spec.hostPID // false | not) and
    (.spec.hostIPC // false | not) and
    (.spec.automountServiceAccountToken // false | not) and
    all(.spec.volumes[]?; has("hostPath") | not) and
    all(.spec.containers[];
      (.securityContext.privileged // false | not) and
      (.securityContext.allowPrivilegeEscalation // true | not) and
      (.securityContext.readOnlyRootFilesystem // false) and
      ((.securityContext.capabilities.drop // []) | index("ALL") != null)
    )
  )
' <<<"$pod_json" >/dev/null; then
  printf '%s\n' 'Judge0 runtime security invariants failed.' >&2
  exit 1
fi

worker="$(kubectl -n "$namespace" get pods -l "$selector",app.kubernetes.io/component=worker -o jsonpath='{.items[0].metadata.name}')"
if kubectl -n "$namespace" exec "$worker" -- ruby -rsocket -e 'TCPSocket.new("1.1.1.1", 443); exit 0' >/dev/null 2>&1; then
  printf '%s\n' 'Judge0 worker unexpectedly reached the public network.' >&2
  exit 1
fi

printf '%s\n' 'Judge0 gVisor pod and network-denial checks passed.'
