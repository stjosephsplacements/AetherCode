# libs/proto

Protocol Buffer definitions and generated Go code for the platform's internal
gRPC contracts. The authorization gRPC service (User ↔ every other service)
is the primary consumer.

## Regenerate

```
make proto
```

This runs `buf lint` then `buf generate` inside this directory. The generated
`.pb.go` and `_grpc.pb.go` files are committed so that services build without
a protoc toolchain.
