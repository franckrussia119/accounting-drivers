FROM node:20-alpine

WORKDIR /app

# better-sqlite3 is a native addon and needs a C++ toolchain to compile
# during npm install on Alpine.
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# The data/ folder holds the SQLite database file — mount a persistent
# volume here on Coolify so it survives redeploys (see README.md).
RUN mkdir -p /app/data

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
