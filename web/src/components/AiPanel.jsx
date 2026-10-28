import React from 'react';
import { LEVELS } from '../../../shared/ai.mjs';
import { Button, Icon } from './ui.jsx';

const BLURB = { novice: '随性落子，偶有疏漏', adept: '攻守均衡', master: '会搜索，擅长连冲' };

// 人机对弈入口。AI 是一个独立的本地测试钱包：每一手仍由人和 AI 双方对完整棋谱签名，
// 链上只有开通与结算，所以协议、合约、证据与真人对局完全相同（FR-27）。
export default function AiPanel({ level, onLevel, side, onSide, stake, disabled, onStart }) {
  return (
    <section className="demo-card ai-card" aria-label="人机对弈">
      <div className="demo-heading"><span className="demo-icon"><Icon name="robot" size={19}/></span><div><h3>与 AI 对弈</h3><p>AI 也是一个独立钱包 · 每手双签</p></div></div>
      <div className="ai-levels" role="radiogroup" aria-label="AI 难度">
        {Object.entries(LEVELS).map(([id, item]) => (
          <button key={id} type="button" role="radio" aria-checked={level === id} className="ai-level" onClick={() => onLevel(id)}>
            <strong>{item.name}</strong><small>{BLURB[id]}</small>
          </button>
        ))}
      </div>
      <div className="side-pick" role="radiogroup" aria-label="选择执子">
        <button type="button" role="radio" aria-checked={side === 1} onClick={() => onSide(1)}><span className="turn-stone"/>执黑先行</button>
        <button type="button" role="radio" aria-checked={side === 2} onClick={() => onSide(2)}><span className="turn-stone white"/>执白后手</button>
      </div>
      <Button kind="primary" icon="play" disabled={disabled} onClick={onStart}>开始人机对弈</Button>
      <p className="ai-note">每人投入 {stake || '—'} 积分。AI 运行在本机浏览器，不联网；终局后同样需要链上结算。</p>
    </section>
  );
}
