# LinkedIn session materialization uses Playwright Firefox; the browser is not bundled with npm.
# Set Railway root directory to this folder (server) and deploy with Dockerfile, or rely on
# package.json postinstall when using Nixpacks.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts \
  && npx playwright install --with-deps firefox

COPY . .
RUN npm run build

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
