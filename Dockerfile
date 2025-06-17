FROM node:22-alpine

# Install ffmpeg and curl in the same layer as npm install
RUN apk add --no-cache ffmpeg curl && \
    npm config set update-notifier false

WORKDIR /app

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy the pre-built application
COPY dist/ ./dist/

# Create non-root user and set permissions
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

CMD ["node", "dist/index.js"]
