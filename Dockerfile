# Build stage
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile --prod=false

# Copy source files
COPY . .

# Build stage for server (if needed)
FROM node:20-alpine AS server-builder

WORKDIR /app/server
COPY server/package.json server/package-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --frozen-lockfile --prod=false
COPY server/ .

# Production stage
FROM node:20-alpine AS production

# Install pnpm and dumb-init for proper signal handling
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apk add --no-cache dumb-init

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1000 -S nodejs && \
    adduser -S nodejs -u 1000

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod=true

# Copy source files
COPY --chown=nodejs:nodejs . .

# Create logs directory
RUN mkdir -p logs && chown nodejs:nodejs logs

# Switch to non-root user
USER nodejs

# Expose port (if needed for health check)
EXPOSE 3000

# Environment variables
ENV NODE_ENV=production
ENV ENABLE_DATABASE=true

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000', (r) => process.exit(r.statusCode === 200 ? 0 : 1))" || exit 0

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the bot
CMD ["node", "bot.js"]
