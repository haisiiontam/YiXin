# 弈·信 运行容器：Node 22 + pnpm 10 + 项目依赖（含 solc / ganache）
# 构建：docker build -t gomoku-channel-lab .
# 运行：docker run --rm -p 4173:4173 -v "%cd%\\artifacts\\runtime:/app/artifacts/runtime" gomoku-channel-lab

FROM node:22-bookworm-slim

# 容器内没有 Windows 的 .npmrc，单独给一份（只保留 hoisted 与镜像源）
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV PNPM_HOME=/usr/local/pnpm \
    PATH=/usr/local/pnpm:$PATH

# 直接用 npm 装 pnpm：比 corepack 少一层网络依赖，版本也钉死
RUN npm install -g pnpm@10.11.0 --registry=$NPM_REGISTRY

WORKDIR /app

# 依赖层单独缓存：只有 lockfile 变化才重装
COPY package.json pnpm-lock.yaml .npmrc.docker ./
RUN mv .npmrc.docker .npmrc && pnpm install --frozen-lockfile --ignore-scripts --registry=$NPM_REGISTRY

# 源码与构建产物
COPY . .
RUN pnpm exec vite build

ENV HOST=0.0.0.0 \
    PORT=4173 \
    CHALLENGE_PERIOD=60

EXPOSE 4173

# 服务自己会编译合约（首次约 1 秒），给足启动时间
HEALTHCHECK --interval=20s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
