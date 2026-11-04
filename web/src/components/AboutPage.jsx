import React from 'react';
import { Button } from './ui.jsx';

const RULES = [
  ['01 / 规则很简单', '黑方先手，交替落子；横、竖或斜线连续至少五子获胜，无禁手。满盘无胜为和棋。'],
  ['02 / 邀请一个真实对手', '创建房间并复制邀请链接，让另一浏览器用独立本地钱包加入。也可以选择与本机 AI 对弈；自动演示由两个本地钱包脚本执棋，界面会明确标记。'],
  ['03 / 证据要可验证', '签名绑定链、合约、对局和完整有序棋谱。可导出棋谱、摘要与签名证据，交易 hash 可复制到本地 RPC 核验。'],
  ['04 / 信任有明确边界', '中继无法代签，但可以拒绝转发。对手拒签时可挑战、链上落子或领取超时结算；诚实方必须在争议窗口内在线响应，不保证永久离线安全。'],
  ['05 / 积分仅用于课程实验', '每地址可注册领取演示积分，存在女巫攻击，积分无资产价值。本地模式的测试私钥保存在浏览器；外部模式由钱包保管私钥，该网络的交易仍需支付 gas。'],
];

export default function AboutPage({ onBack, external = false }) {
  return (
    <div className="about-layout">
      <section className="about-intro">
        <span className="section-kicker">GOMOKU × STATE CHANNEL</span>
        <h2>棋局在链下展开，<br/>信任由链上守护。</h2>
        <p>弈·信使用真实 EVM 合约验证 EIP-712 双签和完整棋谱，结算无资产价值的演示积分。{external ? '当前使用独立 RPC 节点与浏览器钱包；私钥不由应用保管，签名和交易需在钱包中确认。' : '当前节点为本机控制的单节点 Ganache；双钱包自动演示和AI对手均由本机程序控制，不代表公网去中心化或独立玩家。'}</p>
        <div className="about-tags"><span>15 × 15 自由五子棋</span><span>React 19 + Vite 7</span><span>EIP-712 双签</span><span>本地 EVM</span><span>人机对弈</span><span>复盘与证书</span></div>
        <Button kind="primary" icon="arrow" onClick={onBack}>回到对局大厅</Button>
      </section>
      <section className="panel about-rules">
        <h3>开始前，了解这几件事</h3>
        {RULES.map(([title, text]) => <div key={title}><strong>{title}</strong><p>{text}</p></div>)}
      </section>
    </div>
  );
}
