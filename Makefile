SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

SERVICES := gateway identity tenant user question-bank assessment submission judge seb notification analytics
MODULES := libs/pkg $(addprefix services/,$(SERVICES))

.PHONY: help dev-up dev-down dev-judge-up dev-judge-down build test test-integration test-migrations lint proto migrate fmt fmt-check vet vuln verify-workspace

help:
	@printf '%s\n' 'Targets: dev-up dev-down dev-judge-up dev-judge-down build test test-integration test-migrations lint proto migrate fmt fmt-check vet vuln'

verify-workspace:
	@go work sync

dev-up:
	@docker compose --env-file .env --profile platform up -d

dev-down:
	@docker compose --env-file .env --profile platform down --remove-orphans

dev-judge-up:
	@test -f .judge-control.env
	@docker compose --env-file .judge-control.env -f deploy/compose/judge-control.compose.yaml up -d

dev-judge-down:
	@test -f .judge-control.env
	@docker compose --env-file .judge-control.env -f deploy/compose/judge-control.compose.yaml down --remove-orphans

build: verify-workspace
	@for module in $(MODULES); do (cd $$module && go build ./...); done

test: verify-workspace
	@for module in $(MODULES); do (cd $$module && go test ./...); done

test-integration:
	@for module in $(MODULES); do (cd $$module && go test -tags=integration ./...); done

lint: verify-workspace
	@command -v golangci-lint >/dev/null
	@for module in $(MODULES); do (cd $$module && golangci-lint run ./...); done

proto:
	@command -v buf >/dev/null
	@(cd libs/proto && buf lint && buf generate)

migrate:
	@test -n "$(SVC)" && test -n "$(DIR)"
	@test -n "$$DATABASE_URL"
	@(cd libs/pkg && go run ./cmd/migrate --database-url "$$DATABASE_URL" --source "file://$(CURDIR)/services/$(SVC)/migrations" --direction "$(DIR)")

test-migrations: verify-workspace
	@scripts/verify-migrations

fmt:
	@for module in $(MODULES); do (cd $$module && gofmt -w $$(find . -name '*.go' -type f)); done

fmt-check: verify-workspace
	@UNFORMATTED=$$(for module in $(MODULES); do (cd $$module && gofmt -l $$(find . -name '*.go' -type f)); done); \
	if [ -n "$$UNFORMATTED" ]; then printf 'unformatted files:\n%s\n' "$$UNFORMATTED"; exit 1; fi

vet: verify-workspace
	@for module in $(MODULES); do (cd $$module && go vet ./...); done

vuln: verify-workspace
	@command -v govulncheck >/dev/null
	@for module in $(MODULES); do (cd $$module && govulncheck ./...); done
