FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY packages/shared-types ./packages/shared-types
RUN npm --prefix packages/shared-types install --no-audit --no-fund && npm --prefix packages/shared-types run build

COPY services/runtime-worker/package.json services/runtime-worker/package-lock.json ./services/runtime-worker/
RUN npm --prefix services/runtime-worker install --no-audit --no-fund

COPY services/runtime-worker/tsconfig.json ./services/runtime-worker/tsconfig.json
COPY services/runtime-worker/src ./services/runtime-worker/src
RUN npm --prefix services/runtime-worker run build && npm --prefix services/runtime-worker prune --omit=dev

FROM node:22-bookworm-slim AS runtime

LABEL io.my-mate.runtime-worker="true" \
      io.my-mate.runtime-protocol="my_mate_runtime_v1"

ENV NODE_ENV=production
ENV PORT=4040
ENV MY_MATE_WORKSPACE=/workspace

WORKDIR /app/services/runtime-worker

COPY --from=build /app/services/runtime-worker/package.json ./package.json
COPY --from=build /app/services/runtime-worker/node_modules ./node_modules
COPY --from=build /app/services/runtime-worker/dist ./dist
COPY --from=build /app/packages/shared-types /app/packages/shared-types

RUN mkdir -p /workspace && chown -R node:node /app /workspace

USER node
EXPOSE 4040

HEALTHCHECK --interval=5s --timeout=2s --start-period=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4040/health').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/src/daemon.js"]
