# Use Node 22
FROM node:22

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies (skips devDependencies and optionalDependencies)
RUN npm ci --omit=dev --omit=optional

# Copy source code
COPY src ./src

# Expose the port (Railway will set PORT env var to override this)
EXPOSE 3001

# Start the backend server (Railway sets PORT env var)
CMD ["node", "src/backend/server.mjs"]
