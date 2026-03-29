FROM node:24-alpine

WORKDIR /app

COPY package.json server.js index.html styles.css app.js ./

EXPOSE 80

CMD ["node", "server.js"]
