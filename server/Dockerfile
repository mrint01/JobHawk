FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

# Cache deps layer
COPY package*.json ./
RUN npm ci

# Copy source and compile TypeScript
COPY . .
RUN npm run build

ENV NODE_ENV=production

EXPOSE 3001

CMD ["npm", "start"]
