FROM node:20-bullseye

RUN apt-get update && \
    apt-get install -y tesseract-ocr tesseract-ocr-jpn && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN npm install --global pnpm && pnpm install --prod || true
COPY . .

CMD ["node", "server.js"]
