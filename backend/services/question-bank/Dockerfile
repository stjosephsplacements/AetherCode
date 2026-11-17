ARG GO_BUILDER_IMAGE=golang:1.26.11@sha256:f6946db66567acc1497655237e58f06ec3a57478a5e0d67fca29d2ffcf2ea136
FROM ${GO_BUILDER_IMAGE} AS build
ARG SERVICE=question-bank
WORKDIR /src
COPY libs/pkg ./libs/pkg
COPY libs/proto ./libs/proto
COPY services/${SERVICE} ./services/${SERVICE}
ARG BUILD_VERSION=dev
RUN cd services/${SERVICE} && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X github.com/stjosephsplacements/AetherCode/libs/pkg/buildinfo.Version=${BUILD_VERSION}" -o /out/server ./cmd/server

FROM scratch
COPY --from=build /out/server /server
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/server"]
