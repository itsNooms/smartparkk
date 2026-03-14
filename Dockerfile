FROM node:20-bullseye-slim

# Install Chromium and dependencies for puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libgbm1 \
    libnss3-tools \
    fonts-liberation \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use the installed Chromium instead of downloading its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# We are copying the entire project, so both frontend and backend are available
# (Because your server.js relies on the parent folder structure to serve the frontend)
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm install

WORKDIR /app
COPY . .

WORKDIR /app/backend
EXPOSE 3000

CMD ["node", "server.js"]
