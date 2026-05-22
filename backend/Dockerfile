FROM node:18-alpine

WORKDIR /usr/src/app

COPY backend/package*.json ./backend/
WORKDIR /usr/src/app/backend
RUN npm install

WORKDIR /usr/src/app
COPY backend ./backend
COPY frontend ./frontend

WORKDIR /usr/src/app/backend

EXPOSE 3000
CMD ["node", "server.js"]
