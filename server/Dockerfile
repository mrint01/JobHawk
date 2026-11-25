# Playwright's official image ships Chromium + Firefox and their system libs
# preinstalled (in /ms-playwright), so the build never downloads browsers.
# Keep the tag in sync with the "playwright" version in package-lock.json.
FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

# --ignore-scripts: skip postinstall browser downloads (already in the image)
COPY package.json package-lock.json .puppeteerrc.cjs ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
