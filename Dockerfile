# --- build stage -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# --- runtime stage -----------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

# Run as the unprivileged user that ships with the base image.
USER node

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

EXPOSE 3000
CMD ["node", "dist/main.js"]
