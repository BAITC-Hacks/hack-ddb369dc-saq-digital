# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24-bookworm-slim
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:stable-alpine

FROM ${NODE_IMAGE} AS backend-dependencies
WORKDIR /app/backend
COPY backend/package.json ./
RUN npm install --omit=dev --package-lock=false --no-audit --no-fund

FROM ${NODE_IMAGE} AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci --prefix frontend --no-audit --no-fund
# TypeScript also checks the frontend's integration tests against the backend.
COPY --from=backend-dependencies /app/backend/node_modules ./backend/node_modules
COPY backend/package.json backend/config.json backend/purchase-terms.json ./backend/
COPY backend/src ./backend/src
COPY data ./data
COPY frontend ./frontend
RUN npm --prefix frontend run build

FROM ${NODE_IMAGE} AS backend
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --chown=node:node --from=backend-dependencies /app/backend/node_modules ./backend/node_modules
COPY --chown=node:node backend/package.json backend/config.json backend/purchase-terms.json ./backend/
COPY --chown=node:node backend/src ./backend/src
COPY --chown=node:node data ./data
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health', {signal: AbortSignal.timeout(2000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "backend/src/index.js"]

FROM ${NGINX_IMAGE} AS frontend
ENV BACKEND_ORIGIN=http://backend:3001 NGINX_ENVSUBST_FILTER=BACKEND_ORIGIN
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
