# 第三方来源、许可证与自主实现边界

依赖版本由package.json及pnpm-lock.yaml锁定。下表从已安装模块的package.json实际读取；不声称外部框架代码属于本人。完整再分发时须保留对应许可证与间接依赖许可证。

| 模块 | 实际版本 | 许可证 | GitHub来源 | 本项目用途 |
| --- | --- | --- | --- | --- |
| @openzeppelin/contracts | 5.4.0 | MIT | https://github.com/OpenZeppelin/openzeppelin-contracts | 合约EIP712域编码与ECDSA恢复，不复用游戏规则 |
| ethers | 6.17.0 | MIT | https://github.com/ethers-io/ethers.js | 钱包/签名、ABI与JSON-RPC |
| express | 5.1.0 | MIT | expressjs/express | 本地REST/静态页服务 |
| ganache | 7.9.2 | MIT | https://github.com/trufflesuite/ganache | 本地真实EVM测试与持久化 |
| react | 19.1.1 | MIT | https://github.com/facebook/react | 组件状态与UI |
| react-dom | 19.1.1 | MIT | https://github.com/facebook/react | 浏览器渲染 |
| ws | 8.18.3 | MIT | https://github.com/websockets/ws | 链下消息中继 |
| @playwright/test | 1.56.1 | Apache-2.0 | https://github.com/microsoft/playwright | Edge浏览器端到端验证 |
| solc | 0.8.30 | MIT | https://github.com/ethereum/solc-js | 本地Solidity编译器 |
| vite | 7.1.12 | MIT | https://github.com/vitejs/vite | 前端构建与分包 |

自主实现：15×15规则与合法全谱回放、应用专用通道生命周期/积分锁定/前缀争议/强制落子/超时、双签提案协议、证据导入导出核验、同口径逐步上链基线、中文界面与工程文档。Perun/MUD只用于方案研究，没有拷贝其核心通道代码，详见docs/research.md。

文档工具：宿主只读Python运行时的python-docx/python-pptx/Pillow/lxml；PDF文本提取另在工作区.vendor/python安装pypdf6.1.1（BSD-3-Clause）。课程PPT、教案与两份参考报告仅内部参考，来源归原作者，公开源码包不包含这些材料及提取文本。
