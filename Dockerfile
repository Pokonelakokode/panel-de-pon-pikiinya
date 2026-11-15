# Build the client bundle, then run the server on top of it.
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN pnpm exec vite build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY --from=build /app/dist ./dist
COPY src ./src
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD sh -c "wget -qO- http://127.0.0.1:\${PORT:-8787}/api/health || exit 1"
CMD ["node", "src/server/main.ts"]
