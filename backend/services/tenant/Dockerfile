ARG GO_BUILDER_IMAGE=golang:1.26.10@sha256:672c944cfd07599b5f1bb179869270cdc94c6254e41db4d431259693cb286b82
FROM ${GO_BUILDER_IMAGE} AS build
ARG SERVICE=tenant
WORKDIR /src
COPY libs/pkg ./libs/pkg
COPY libs/proto ./libs/proto
COPY services/${SERVICE} ./services/${SERVICE}
RUN cd services/${SERVICE} && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/server ./cmd/server

FROM scratch
COPY --from=build /out/server /server
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/server"]
