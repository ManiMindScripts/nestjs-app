############### Toolchain  ###############

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --include=dev

########### TypeScript ###########
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npx nest build

#########3 Run-time dependency tree #########
FROM node:24-slim AS deps-prod
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

######## Prod- Image ############
FROM node:24-slim AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps-prod --chown=node:node /app/node_modules ./node_modules
COPY --from=build  --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json docker-entrypoint.sh ./
RUN mkdir -p logs && chown node:node logs

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/'+(process.env.API_PREFIX||'api')+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  
ENTRYPOINT ["./docker-entrypoint.sh"]  