FROM node:22.20.0-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/flight-source/package.json packages/flight-source/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @flightcheck/worker... build

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/flight-source/package.json packages/flight-source/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM build AS migrate
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["bash", "scripts/migrate.sh"]

FROM node:22.20.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=Asia/Macau
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir /backups \
  && chown node:node /backups
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=production-dependencies --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/worker/dist ./apps/worker/dist
COPY --from=build --chown=node:node /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build --chown=node:node /app/packages/db/dist ./packages/db/dist
COPY --from=build --chown=node:node /app/packages/db/src/generated ./packages/db/src/generated
COPY --from=build --chown=node:node /app/packages/domain/dist ./packages/domain/dist
COPY --from=build --chown=node:node /app/packages/flight-source/dist ./packages/flight-source/dist
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/scripts ./scripts
USER node
CMD ["node", "apps/worker/dist/index.js"]
