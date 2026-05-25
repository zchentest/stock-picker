FROM node:20-alpine

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm ci --production

# 复制源码
COPY server.js ./
COPY public/ ./public/

# Hugging Face Spaces 要求的端口
ENV PORT=7860
EXPOSE 7860

CMD ["node", "server.js"]
