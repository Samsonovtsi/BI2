# Дашборд «ЭР и АКК» с бэкендом на Node.js/Express.
# Бэкенд сам ходит в Google Sheets, кэширует данные и отдаёт фронтенд + API.
# Используется, если в Timeweb Cloud App Platform выбран тип "Dockerfile"
# (альтернатива — нативный тип "Express" для Node.js, см. README.md).

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "index.js"]
