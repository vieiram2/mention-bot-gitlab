FROM node:10.14-alpine

COPY . /usr/src/app

WORKDIR /usr/src/app

RUN npm install --no-progress

CMD ["node", "server.js"]
