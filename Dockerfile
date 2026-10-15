FROM node:24-alpine

WORKDIR /app

# Install dependencies first for efficient layer caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source
COPY . .

# Directory for SQLite persistent volume
RUN mkdir -p /data

ENV PORT=5055 \
    NODE_ENV=production \
    DB_PATH=/data/gpsbeacon.db

EXPOSE 5055

CMD ["node", "server.js"]
