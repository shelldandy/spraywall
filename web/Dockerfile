FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# nginx.conf is mounted from infra/nginx by docker-compose.
FROM nginx:alpine
COPY --from=build /src/dist /usr/share/nginx/html
