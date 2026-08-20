# Copilot instructions for AlgoQX

## Stack

- Backend services are written in Go using the repository module path github.com/aethercode/aethercode and Go 1.26.x.
- The repo uses a Go workspace in go.work for shared libraries and service modules under services/.
- Frontend work should target Next.js App Router with TypeScript and Tailwind when a web app is present.

## Formatting and linting

- Format Go code with gofumpt and goimports before committing.
- Use Prettier and ESLint for TypeScript, React, and Next.js code.
- Keep format-on-save enabled in VS Code.

## Testing conventions

- Prefer table-driven tests in Go and use testify where it already fits the codebase.
- Use Playwright for end-to-end tests when browser flows are involved.
- Use Vitest or Jest for unit tests when the package.json in the relevant frontend package includes them.

## Repository-specific conventions

- Follow the service-oriented layout under services/ and shared libraries under libs/.
- Preserve the existing module boundaries; avoid introducing cross-service coupling without a clear reason.
- Keep deployment and migration concerns aligned with the docs and scripts in deploy/ and scripts/.
- Respect the repository’s focus on Go services and the existing documentation in docs/ and README.md.
