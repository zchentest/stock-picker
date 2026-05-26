FROM node:20-alpine

WORKDIR /app

# 安装 git（运行时需要拉代码）
RUN apk add --no-cache git

# Hugging Face Spaces 要求的端口
ENV PORT=7860
EXPOSE 7860

# 每次启动时动态拉取最新代码 + 安装依赖 + 启动服务
# 这样 Restart Space 就能自动获取 GitHub 上的最新代码
CMD sh -c "git clone https://github.com/zchentest/stock-picker.git . 2>/dev/null; \
           npm ci --production && \
           node server.js"
