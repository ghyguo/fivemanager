FROM node:22-alpine

WORKDIR /app

# Install Chinese fonts used when generating organization QR code images.
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.ustc.edu.cn/g' /etc/apk/repositories \
    && apk add --no-cache font-noto-cjk fontconfig \
    && fc-cache -f

# Install the API's production dependencies.
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Copy the Node.js API and its questionnaire configuration.
COPY backend/src ./src
COPY backend/questionnaire ./questionnaire

ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "src/server.js"]
