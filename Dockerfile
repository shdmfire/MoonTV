# ---- 第 1 阶段：安装依赖 ----
FROM node:20-alpine AS deps

# 启用 corepack 并激活 pnpm（Node20 默认提供 corepack）
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# 仅复制依赖清单，提高构建缓存利用率
COPY package.json pnpm-lock.yaml ./

# 安装所有依赖（含 devDependencies，后续会裁剪）
RUN pnpm install --frozen-lockfile

# ---- 第 2 阶段：构建项目 ----
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# 复制依赖
COPY --from=deps /app/node_modules ./node_modules
# 复制全部源代码
COPY . .

# 在构建阶段也显式设置 DOCKER_ENV，
# 确保 Next.js 在编译时即选择 Node Runtime 而不是 Edge Runtime
RUN find ./src -type f -name "route.ts" -print0 \
  | xargs -0 sed -i "s/export const runtime = 'edge';/export const runtime = 'nodejs';/g"
ENV DOCKER_ENV=true

# For Docker builds, force dynamic rendering to read runtime environment variables.
RUN sed -i "/const inter = Inter({ subsets: \['latin'] });/a export const dynamic = 'force-dynamic';" src/app/layout.tsx

# 生成生产构建
RUN pnpm run build

# ---- 第 3 阶段：生成运行时镜像 ----
FROM node:20-alpine AS runner

# 安装必要的运行时依赖
RUN apk add --no-cache \
    ffmpeg \
    curl \
    ca-certificates \
    tzdata \
    && rm -rf /var/cache/apk/*

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DOCKER_ENV=true

# 下载并安装 N_m3u8DL-RE
RUN mkdir -p /app/tools && \
    cd /app/tools && \
    curl -L -o N_m3u8DL-RE.tar.gz https://github.com/nilaoda/N_m3u8DL-RE/releases/latest/download/N_m3u8DL-RE_linux_x64.tar.gz && \
    tar -xzf N_m3u8DL-RE.tar.gz && \
    rm N_m3u8DL-RE.tar.gz && \
    chmod +x N_m3u8DL-RE

# 创建下载目录并设置权限
RUN mkdir -p /vol1/1000/Movies && \
    chown -R nextjs:nodejs /vol1/1000/Movies && \
    chmod 755 /vol1/1000/Movies

# 从构建器中复制 standalone 输出
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# 从构建器中复制 public 和 .next/static 目录
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/config.json ./config.json

# 确保下载器和下载目录的权限正确
RUN chown -R nextjs:nodejs /app/tools && \
    chmod 755 /app/tools/N_m3u8DL-RE

# 切换到非特权用户
USER nextjs

EXPOSE 3000

# 使用 node 直接运行 server.js
CMD ["node", "server.js"] 