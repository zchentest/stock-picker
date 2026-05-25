FROM node:20-alpine

WORKDIR /app

# 从 GitHub 拉取项目代码
RUN apk add --no-cache git && \
    git clone https://github.com/zchentest/stock-picker.git . && \
    apk del git

# 安装依赖
RUN npm ci --production

# Hugging Face Spaces 要求的端口
ENV PORT=7860
EXPOSE 7860

CMD ["node", "server.js"]
