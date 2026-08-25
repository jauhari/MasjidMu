FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

FROM base AS deps
# Alpine's glibc-less musl can't run Puppeteer's default Chromium download --
# skip it here and use the Alpine `chromium` package installed in the
# runtime stage instead (see PUPPETEER_EXECUTABLE_PATH below).
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json ./backend/
COPY shared/package.json ./shared/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY tsconfig.base.json ./
COPY shared ./shared
COPY backend ./backend
RUN pnpm --filter @masjidmu/backend build

FROM base AS runtime
ENV NODE_ENV=production
# Puppeteer (backend/src/modules/accounting/reports/export/browser.ts) needs
# a real Chromium -- Alpine's own musl-compatible build, not the glibc one
# Puppeteer would otherwise try to download.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/shared/node_modules ./shared/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/package.json ./backend/
COPY --from=build /app/shared ./shared
EXPOSE 3000
WORKDIR /app/backend
CMD ["node", "dist/src/index.js"]
