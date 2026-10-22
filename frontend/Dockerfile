FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN npm install -g pnpm@12.6.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# GATEWAY_URL and PUBLIC_ORIGIN are read at runtime, not baked into the build.
RUN pnpm build

# The standalone server needs only its own output, the static assets and public/.
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN useradd --system --uid 1001 web
COPY --from=build --chown=web /app/.next/standalone ./
COPY --from=build --chown=web /app/.next/static ./.next/static
COPY --from=build --chown=web /app/public ./public
USER web
EXPOSE 3000
CMD ["node", "server.js"]
