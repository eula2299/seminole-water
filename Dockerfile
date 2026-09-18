FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json /app/package.json
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node . /app
RUN mkdir -p /app/data/investigations && chown -R node:node /app/data
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "run", "start"]
