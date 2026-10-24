FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# Downloads the PDF from EASA and builds data/rules.json; logs the coverage check against the table of contents.
RUN node scripts/build-index.js
ENV NODE_ENV=production
CMD ["node", "src/server.js"]
