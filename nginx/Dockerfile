# syntax=docker/dockerfile:1
#
# One image that contains both React apps and the nginx that serves them.
#
#   docker build -f nginx/Dockerfile -t casino-frontend .
#
# Run this build from the REPOSITORY ROOT (the compose file sets the context for
# you), because it needs `web/`, `admin/` and `nginx/default.conf`.
#
# The apps are built with VITE_API_URL=/api so every request goes back to the same
# origin and nginx proxies it — no hardcoded host, no CORS pre-flight in production.

# ---------- player web app ------------------------------------------------
FROM node:20-alpine AS web

WORKDIR /app

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./

ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

# ---------- admin panel ---------------------------------------------------
FROM node:20-alpine AS admin

WORKDIR /app

COPY admin/package.json admin/package-lock.json ./
RUN npm ci

COPY admin/ ./

ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

# ---------- nginx + both builds ------------------------------------------
FROM nginx:1.27-alpine AS runtime

# The stock welcome page would win on `/`, so replace the whole default config.
RUN rm -f /etc/nginx/conf.d/default.conf

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=web /app/dist /usr/share/nginx/html/web
COPY --from=admin /app/dist /usr/share/nginx/html/admin

EXPOSE 80 443
