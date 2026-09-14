FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    ODM_MCP_HOST=0.0.0.0 \
    ODM_MCP_PORT=3006

WORKDIR /app
COPY mcp/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY mcp/server.mjs ./server.mjs
RUN chown -R node:node /app
USER node
EXPOSE 3006
HEALTHCHECK --interval=30s --timeout=8s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3006/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
