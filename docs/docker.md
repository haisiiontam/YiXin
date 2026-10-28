# 用 Docker 运行弈·信

镜像里固化了三样东西，不再依赖宿主机的任何环境：

| 层 | 内容 |
|---|---|
| Node 运行时 | `node:22-bookworm-slim`（满足 ≥20.19） |
| 包管理器 | pnpm 12.15.0（镜像内全局安装） |
| 项目依赖 | ethers / express / ganache / react / solc 等，按 `pnpm-lock.yaml` 锁定版本 |

> Windows 上的 VC++ 运行库和 WebView2 与 Linux 容器无关，镜像里不需要；
> 浏览器只在跑 `pnpm run test:e2e` 时才需要，那一步在宿主机做。

## 构建与运行

```bash
# 构建（首次约 1-2 分钟，依赖层会缓存）
docker build -t gomoku-channel-lab .

# 运行，数据持久化到宿主机的 artifacts/runtime
docker run --rm -p 4173:4173 \
  -v "$PWD/artifacts/runtime:/app/artifacts/runtime" \
  gomoku-channel-lab
```

或者直接：

```bash
docker compose up --build
```

浏览器打开 <http://127.0.0.1:4173>。

## 可调环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `4173` | 监听端口 |
| `HOST` | `127.0.0.1`（镜像内为 `0.0.0.0`） | 绑定地址，容器里必须是 `0.0.0.0` 才能被端口映射到 |
| `CHALLENGE_PERIOD` | `60` | 挑战期秒数 |
| `EXTRA_ORIGINS` | 空 | 额外允许的来源，逗号分隔（换了域名/端口访问时用） |

## 数据与重置

链数据、合约地址、房间记录都在 `artifacts/runtime`：

- **保留**：默认挂载该目录，重启容器接着上一局，链上地址不变。
- **全新开局**：`rm -rf artifacts/runtime` 后重启（会重新部署合约，得到新地址）。

> 注意：链上记录一旦随目录保留，EIP-712 domain 仍是 `chainId + 合约地址`，
> 重建到**相同**地址时旧签名理论上可重放——这正是 README 里写的 v1 已知边界。

## 国内网络注意事项

`node:22-bookworm-slim` 从 Docker Hub 直拉会超时。本机做了两处配置（改在 Docker 侧，不在仓库里）：

1. `~/.docker/daemon.json` 增加镜像源：
   ```json
   "registry-mirrors": ["https://docker.m.daocloud.io", "https://docker.xuanyuan.me", "https://dockerproxy.net"]
   ```
2. Docker Desktop → Settings → Resources → Proxies 指向 `http://127.0.0.1:7897`（clash 本地代理），
   对应 `%APPDATA%\Docker\settings-store.json` 的 `ProxyHttpMode / OverrideProxyHttp / OverrideProxyHttps`。

镜像内的 npm/pnpm 走 `registry.npmmirror.com`，不受这条影响。

## 构建结果（2026-10-28 实测）

```
gomoku-channel-lab:latest   970 MB   构建约 40 秒（含拉基础镜像）
容器  Up (healthy)   0.0.0.0:4173->4173/tcp
/api/health  {"ok":true,"chainId":31337,"contractAddress":"0xe78A…a8Ab"}
/rpc 拦截 evm_mine → -32601（安全策略在容器里同样生效）
```

镜像偏大是因为打进了 `solc`（合约编译器）和 `ganache`——服务启动时要现场编译合约。
若只想运行、不改合约，可以把编译挪到构建期，镜像能瘦到约 400 MB。

## 已知限制

1. 容器内的 Ganache 使用纯 JS 实现（镜像构建用了 `--ignore-scripts`，不编译原生 uWS），
   性能低于原生，但真实合约执行与测试不受影响。
2. 服务默认只监听容器内的 `0.0.0.0`，**请不要把 4173 直接暴露到公网**；
   本项目的 RPC 虽然已禁用 `evm_*`/`personal_*`/`eth_accounts` 等管理方法，
   但它仍然是本地教学环境，没有身份与反滥用设计。
3. `artifacts/runtime` 挂载目录的属主是宿主用户，Linux 宿主上如果出现权限错误，
   先 `chown -R 1000:1000 artifacts/runtime` 或用 `docker compose run --user` 覆盖。
