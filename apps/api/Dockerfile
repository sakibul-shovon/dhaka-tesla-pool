FROM node:24-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace=packages/shared && npm run build --workspace=apps/api

FROM node:24-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api/dist apps/api/dist
RUN groupadd --system app && useradd --system --gid app app && chown -R app:app /repo
USER app
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
