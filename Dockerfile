FROM node:20-bullseye

# Install dependencies for Puppeteer/Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

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
