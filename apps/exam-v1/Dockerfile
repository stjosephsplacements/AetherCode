FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN npm install -g pnpm@12.6.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm@12.6.0 && useradd --system --uid 1001 exam
COPY --from=build --chown=exam /app ./
USER exam
EXPOSE 3000
CMD ["pnpm", "start", "--port", "3000"]
