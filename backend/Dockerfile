FROM node:22-alpine
WORKDIR /app
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.ustc.edu.cn/g' /etc/apk/repositories \
    && apk add --no-cache font-noto-cjk fontconfig \
    && fc-cache -f
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY questionnaire ./questionnaire
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "src/server.js"]
