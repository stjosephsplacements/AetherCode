ARG GO_BUILDER_IMAGE=golang:1.26.5@sha256:3aff6657219a4d9c14e27fb1d8976c49c29fddb70ba835014f477e1c70636647
FROM ${GO_BUILDER_IMAGE} AS build
ARG SERVICE=judge
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
EXPOSE 8443
ENTRYPOINT ["/server"]
