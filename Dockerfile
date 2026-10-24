FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends unzip poppler-utils file && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
CMD ["node", "probe.js"]
