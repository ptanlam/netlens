# --- deps ---
FROM node:26.5.0-alpine3.23 AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build ---
FROM node:26.5.0-alpine3.23 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- runner ---
FROM node:26.5.0-alpine3.23 AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
# Extra CA intermediates for upstreams that serve incomplete TLS chains (lib/tls.ts).
COPY --from=build /app/certs ./certs

EXPOSE 3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
