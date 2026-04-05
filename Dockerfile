FROM node:20-bullseye-slim

WORKDIR /app

# Copy backend deps and install first (for Docker layer caching)
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm install --omit=dev

# Copy full project (backend + frontend)
WORKDIR /app
COPY . .

WORKDIR /app/backend
EXPOSE 3000

CMD ["node", "server.js"]
