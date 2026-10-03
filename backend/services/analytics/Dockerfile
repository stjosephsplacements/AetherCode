ARG GO_BUILDER_IMAGE=golang:1.26.7@sha256:45a5f7a810238aabcbad211d70b9ae082022d96f7c7259e94041ad1b933575ac
FROM ${GO_BUILDER_IMAGE} AS build
ARG SERVICE=analytics
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
