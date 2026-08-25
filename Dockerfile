FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS build
ENV NODE_ENV=development
COPY . .
RUN pnpm install --frozen-lockfile --prod=false
RUN pnpm --filter @masjidmu/backend build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/shared/node_modules ./shared/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/package.json ./backend/
COPY --from=build /app/shared ./shared
EXPOSE 3000
WORKDIR /app/backend
CMD ["node", "dist/src/index.js"]
