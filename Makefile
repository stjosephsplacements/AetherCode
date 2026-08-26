SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

SERVICES := gateway identity tenant user question-bank assessment submission judge seb notification analytics
MODULES := libs/pkg $(addprefix services/,$(SERVICES))

.PHONY: help dev-up dev-down dev-judge-up dev-judge-down build test test-integration test-migrations lint proto migrate bootstrap rotate-authz-key fmt fmt-check vet vuln verify-workspace

help:
	@printf '%s\n' 'Targets: dev-up dev-down dev-judge-up dev-judge-down build test test-integration test-migrations lint proto migrate bootstrap rotate-authz-key fmt fmt-check vet vuln'

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

bootstrap:
	@test -n "$(EMAIL)" || { echo "EMAIL is required"; exit 1; }
	@test -n "$(NAME)" || { echo "NAME is required"; exit 1; }
	@test -n "$$IDENTITY_DATABASE_URL" || { echo "IDENTITY_DATABASE_URL is required"; exit 1; }
	@test -n "$$USER_DATABASE_URL" || { echo "USER_DATABASE_URL is required"; exit 1; }
	@(cd libs/pkg && go run ./cmd/bootstrap \
		--identity-database-url "$$IDENTITY_DATABASE_URL" \
		--user-database-url "$$USER_DATABASE_URL" \
		--email "$(EMAIL)" --display-name "$(NAME)")

rotate-authz-key:
	@test -n "$(ACTION)" || { echo "ACTION is required (publish|retire)"; exit 1; }
	@test -n "$(AUDIENCE)" || { echo "AUDIENCE is required"; exit 1; }
	@test -n "$$DATABASE_URL" || { echo "DATABASE_URL is required"; exit 1; }
	@(cd libs/pkg && go run ./cmd/rotate-authz-key \
		--action "$(ACTION)" --audience "$(AUDIENCE)" --database-url "$$DATABASE_URL" \
		$(if $(KEY_ID),--key-id "$(KEY_ID)") $(if $(NOT_BEFORE),--not-before "$(NOT_BEFORE)") $(if $(NOT_AFTER),--not-after "$(NOT_AFTER)"))

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
