FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN npm install -g pnpm@12.6.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# DATABASE_URL, GATEWAY_URL, ENGINE_URL and VERIFY_SECRET are read at runtime, not baked into the build.
RUN pnpm build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3300 HOSTNAME=0.0.0.0
RUN npm install -g pnpm@12.6.0 && useradd --system --uid 1001 intake
COPY --from=build --chown=intake /app/.next/standalone ./
COPY --from=build --chown=intake /app/.next/static ./.next/static
COPY --from=build --chown=intake /app/public ./public
COPY --from=build --chown=intake /app/db ./db
COPY --from=build --chown=intake /app/scripts ./scripts
USER intake
EXPOSE 3300
CMD ["node", "server.js"]
