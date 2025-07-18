FROM node:22-alpine

# Install ffmpeg and curl
RUN apk add --no-cache ffmpeg curl

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy the pre-built application
COPY dist/ ./dist/

EXPOSE 3000

CMD ["node", "dist/index.js"]
