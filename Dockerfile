FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

# Install server dependencies first for better layer caching.
COPY server/package*.json ./server/
RUN npm ci --prefix server

# Copy server source and build TypeScript.
COPY server ./server
RUN npm run build --prefix server

WORKDIR /app/server
ENV NODE_ENV=production

EXPOSE 3001
CMD ["npm", "start"]
