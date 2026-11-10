# 独立 RPC 接入、部署身份与手动部署

实现日期：2026-11-04。服务端使用项目锁定的 ethers 与 Ganache 依赖；实际安装版本应以安装环境及锁文件为准。原有模式执行真实 Solidity/EVM，但节点和测试账户由本服务本地托管。`CHAIN_MODE=external` 改用独立 HTTP(S) JSON-RPC 节点读取已部署合约，浏览器由用户点击连接注入钱包，由钱包签名和发送交易。是否属于公网、联盟链或另一台本地节点，取决于运营者选择的网络。本轮验收只使用独立的本机 Ganache JSON-RPC 节点，没有公网部署或真实资产费用。

## ADR：独立链与签名边界

外部模式没有自动部署、服务器钱包、账户解锁、服务端私钥签名或测试币注资路径。`POST /api/faucet` 返回 403。服务端只读合约状态和交易回执；`/rpc` 仅允许明确列出的读取、估算和客户端已签名原始交易广播方法。`eth_sendRawTransaction` 会向所选节点广播，用户应只在外部钱包确认后使用；它不是服务器签名。

启动在提供 HTTP 服务前验证实际 `eth_chainId`、创世区块与网络 ID、目标非空代码的 keccak256、部署区块、构造周期、`eip712Domain()` 和 `stateDigest()`，并读取 `getChannel(bytes32(0))` 检查当前九字段通道布局。空通道必须具有零地址 black/white、全为零的 stake/status/deadline/proofDeadline/winner/reason 和空 moves，才能启动。旧版八字段结构即使提供了真实代码 hash、周期和正确签名域，也会被拒绝；其动态 bytes 偏移可能被新版 ABI 误解码为 `proofDeadline=256`，因此仅成功解码不代表兼容。零 ID 是启动探针；有效对局 ID 由参与者和 salt 的 keccak256 派生。部署区块必须是目标地址代码首次出现的区块，节点因此需要支持该地址部署前后的历史代码查询。此实现针对直接部署的 GomokuChannel，不提供代理升级协议。

`EXPECTED_RUNTIME_CODE_HASH` 是运营者在独立可信渠道核实后提供的信任锚。匹配这个 hash 只能证明当前节点返回的代码与该锚一致；不能自动证明源码经过认证、运营者诚实、RPC 诚实或底层共识安全。单节点仍可能提供虚假视图，重要结算应使用独立节点或区块浏览器复核。EIP-712 域检查与示例 stateDigest 检查验证协议兼容性，也不构成完整语义证明。

编译器输出的 runtime bytecode 包含 immutable 占位符，不能直接拿模板 keccak256 与部署后的代码比较。本地 manifest 分别存储 `creationArtifactHash = keccak256(creation bytecode)` 和部署完成后的真实 `runtimeCodeHash = keccak256(eth_getCode(address))`，构造参数另行保存并通过合约 getter 验证。

## 接入已有部署

PowerShell 示例只设置进程环境，不把 RPC 凭据写入源码。以下占位符需要替换为运营者独立核实的数据；不要把含用户名、密码或 API token 的 URL 粘贴进报告、截图或终端共享记录。

```powershell
$env:CHAIN_MODE = 'external'
$env:RPC_URL = '<独立 HTTP(S) RPC URL>'
$env:EXPECTED_CHAIN_ID = '<实际 chainId，十进制或0x十六进制>'
$env:CONTRACT_ADDRESS = '<直接部署的 GomokuChannel 地址>'
$env:DEPLOYMENT_BLOCK = '<部署交易所在区块>'
$env:EXPECTED_RUNTIME_CODE_HASH = '<经独立核实的0x开头32字节代码hash>'
$env:CHALLENGE_PERIOD = '60'
$env:INVITE_PERIOD = '300'
$env:NETWORK_NAME = 'Operator verified EVM'
$env:RUNTIME_DIR = Join-Path (Get-Location).Path 'artifacts\runtime-external-new'
node server/index.mjs
```

`CHALLENGE_PERIOD` 与 `INVITE_PERIOD` 默认 60/300 秒，必须与目标合约的真实构造参数一致。`EXPECTED_CHAIN_ID`、`CONTRACT_ADDRESS`、`DEPLOYMENT_BLOCK`、`EXPECTED_RUNTIME_CODE_HASH` 和 `RPC_URL` 没有外部模式默认值。`NETWORK_NAME` 仅用于展示，不能覆盖链 ID 校验。容器使用容器内实际应用根目录下的专用运行目录，例如 `/app/artifacts/runtime-external-new`。

服务器不会把 RPC URL 返回到浏览器配置或打印到日志。上游错误会隐藏端点，`/rpc` 外部上游错误使用通用文本，不透传错误 data。部署 manifest 也不记录 URL。运营者仍需妥善保管自行设置的环境变量和容器编排配置。

`GET /api/config` 返回：

```javascript
{
  mode: 'external', walletMode: 'injected', chainId, address, abi,
  networkName, challengePeriod, invitePeriod, deploymentBlock,
  runtimeCodeHash,
  domain: { name: 'GomokuChannel', version: '1', chainId, verifyingContract: address },
  pointsInitial: 1000
}
```

本地模式对应 `mode: 'local-teaching'`、`walletMode: 'local-test'`。积分仍是教学合约记账，每个地址可注册领取初始积分，不等价于有真实资产抵押的货币。

RPC 白名单为 `eth_chainId`、`net_version`、`eth_blockNumber`、`eth_call`、`eth_getLogs`、`eth_getTransactionReceipt`、`eth_getTransactionByHash`、按区块及索引获取交易、`eth_getTransactionCount`、按编号或 hash 获取区块、`eth_getCode`、`eth_getBalance`、`eth_getStorageAt`、`eth_estimateGas`、`eth_gasPrice`、`eth_maxPriorityFeePerGas`、`eth_feeHistory` 和 `eth_sendRawTransaction`。批量请求限 1 至 50 项。未列出的方法全部拒绝，包括 `eth_accounts`、`eth_sendTransaction`、`eth_sign`、`personal_*`、`admin_*`、`debug_*`、`evm_*` 和 `ganache_*`。

## 本地链复用与漂移处理

默认仍为 `CHAIN_MODE=local`，运行目录为应用内 `artifacts/runtime`。本地 chainId 和 networkId 固定为 31337，避免 Ganache 默认网络 ID 随重启时间变化。默认 `LOCAL_BLOCK_TIME=1` 秒使空闲期也产生区块，争议证明等待与超时可随链时间推进；独立测试 fixture 可显式设置为 0 采用交易即出块。不会对浏览器开放时间或出块管理 RPC。新建的本地目录会部署合约；已有部署必须包含 schema version 2 manifest，且 creation artifact hash、真实 runtime hash、构造周期、创世区块 hash、chainId、网络 ID、部署区块 hash 与部署回执均一致才能复用。

旧 manifest 缺少身份数据、代码消失、源码编译产物改变、周期改变或链指纹漂移时，服务明确拒绝启动。不会静默重新部署、清空目录或迁移旧积分和房间。请保留旧目录，并为新的协议版本选择工作区内的全新 `RUNTIME_DIR`。外部模式也绑定自己的运行目录，防止把一条链的房间误接到另一条链。Windows 目录及其已有符号链接祖先必须仍在 `E:\Gomoku` 内；容器限制在实际应用目录内。

## 手动部署准备

本轮不自动执行任何公网部署。新增准备脚本没有私钥处理、签名或广播功能；缺少授权参数立即非零退出。持有人需要自己在外部钱包确认部署网络、构造参数和费用。

```powershell
$env:RPC_URL = '<独立 RPC URL>'
$env:EXPECTED_CHAIN_ID = '<已核实的 chainId>'
$env:DEPLOYER_ADDRESS = '<外部钱包公开地址>'
$env:CHALLENGE_PERIOD = '60'
$env:INVITE_PERIOD = '300'
node scripts/deploy-external.mjs --prepare-authorized
```

该命令只读取 chainId 并估算部署 gas，在 `artifacts/deployment-preparations` 产生含 `from`、`to:null`、`data`、`chainId`、`gasEstimate` 和 ABI 的未签名 JSON。估算不是费用报价。使用可信钱包/部署工具审阅该数据并自行签名广播；也可直接在熟悉的 Solidity 部署工具中使用同一源码、编译设置和构造参数。不要把私钥、助记词或钱包备份交给服务器。

完成手动部署后保存成功回执中的地址、交易 hash、部署区块；从独立可信节点或浏览器取得运行时代码并计算 keccak256，核实代码与构造参数后再设置外部模式信任锚。准备脚本的 creation artifact hash 不能替代部署后 runtime code hash。

## 可重现测试与工程日志

```powershell
# 在应用根目录执行，缓存、临时目录与证据均留在工作区
$env:TEMP = Join-Path (Get-Location).Path '.tmp\external-chain-tests'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
node --test --test-concurrency=1 tests/chain-runtime.test.mjs
```

测试启动独立 `ganache.server` JSON-RPC 节点，先由测试装置部署一次，再通过真实 HTTP RPC 接入 external 分支。测试记录初始化无自动部署/注资、外部 faucet 拒绝、RPC 白名单与原始交易广播、错误链 ID/hash/周期/部署区块拒绝、本地重启复用、artifact/runtime/参数/链指纹漂移拒绝与旧 manifest 拒绝。原始输出与机器可读结果保留在 `artifacts/test-results/trust-audit-2026-11-04`，不输出私钥。最终实测结论以该目录的真实结果为准。

2026-11-04 工程变更记录：引入独立链初始化及校验模块；将 HTTP 服务接到统一 runtime；以严格白名单代理 RPC；外部钱包与服务器签名边界分离；持久化身份升级为拒绝漂移的 manifest；提供仅准备未签名部署数据的手动入口。首轮 9 项中 7 项通过，2 项暴露 Ganache 默认 net_version 随重启时间变化导致的复用误拒绝，原始失败记录以 `*-first-run` 保留；固定本地 networkId 后修复，并补充域/digest、未签名准备和周期出块测试。该阶段同一命令实测 12/12 通过，退出码 0，耗时约 14.6 秒；`git diff --check -- server/index.mjs` 通过。环境中 Ganache 的 µWS 原生扩展不匹配当前 Node，实际使用其 NodeJS fallback 完成全部测试。未运行公网部署，没有真实资产费用。

2026-11-04 复核修复：单独验证旧新共用的 getter/domain/digest 无法识别缺少 proofDeadline 的旧通道结构。新增空通道九字段布局断言，并在独立 Ganache 上部署真实 Solidity 八字段回归合约，使用其真实 runtime hash、正确周期和签名域启动应用。已复现旧结构被新 ABI 解码为 `proofDeadline=256`，并确认应用在注册或开局付 gas 前拒绝，区块高度与部署者 nonce 未变化、registrationCount/openingCount 都为 0。保留原 12 项后同一命令最终实测 13/13 通过，退出码 0，耗时约 14.5 秒；机器结果中的 `observations.legacyLayoutRejection` 记录本机链地址、部署交易、代码 hash 与误解码值。
