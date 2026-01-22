# Use Node 22
FROM node:22

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies (skips devDependencies and optionalDependencies)
RUN npm ci --omit=dev --omit=optional

# Copy source code
COPY src ./src

# Expose port
EXPOSE 3001

# Start the backend server
CMD ["node", "src/backend/server.mjs"]
