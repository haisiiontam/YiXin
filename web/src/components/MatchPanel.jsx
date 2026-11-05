import React from 'react';
import { Button, CopyButton, Icon, short } from './ui.jsx';

function Player({ color, label, address, own, active }) {
  return (
    <div className={`player ${active ? 'active' : ''}`}>
      <span className={`player-stone ${color}`}/>
      <strong>{label}{own && <small>你</small>}</strong>
      <span className="player-address" title={address}>{address ? short(address, 4) : '等待加入'}</span>
    </div>
  );
}

// 对局控制：玩家、积分、创建/加入房间、待确认提案与结算。
// 所有按钮的可访问名称与旧版保持一致，浏览器端到端脚本依赖这些名称。
export default function MatchPanel({ c }) {
  const { state, client, busy, act, hasRoom, finished, stake, setStake, room, setRoom, inviteCode, role, result, isParticipant, copy } = c;
  const joinRoom = () => act('正在加入对局', () => {
    let code = room.trim();
    if (code.includes('://')) { try { code = new URL(code).searchParams.get('room') || code; } catch { /* 无效链接交由客户端报错 */ } }
    return client.joinRoom(code);
  });
  return (
    <section className="panel match-panel">
      <div className="panel-title"><h2>对局控制</h2><span className={`connection-dot ${state.connected ? 'online' : ''}`}>{state.mode === 'ai' ? '本地 AI' : state.connected ? '中继在线' : '中继离线'}</span></div>
      <div className="players">
        <Player color="black" label="黑方 · 先手" address={state.black} own={state.role === 1} active={state.status === 'active' && state.nextPlayer === 1}/>
        <div className="versus">VS</div>
        <Player color="white" label="白方 · 后手" address={state.white} own={state.role === 2} active={state.status === 'active' && state.nextPlayer === 2}/>
      </div>
      <div className="stake-line"><span>每人投入</span><strong>{hasRoom ? state.stake : stake || '—'} <small>积分</small></strong><span className="pool">{hasRoom && state.white ? `总奖池 ${Number(state.stake) * 2}` : '无现实价值'}</span></div>
      {!hasRoom || finished ? (
        <div className="room-form">
          <label htmlFor="stake">对局积分</label>
          <div className="stake-input"><input id="stake" type="number" min="1" step="1" inputMode="numeric" value={stake} disabled={busy} onChange={(e) => setStake(e.target.value)}/><span>积分 / 人</span></div>
          <Button kind="primary" icon="board" disabled={!state.ready || busy || !Number.isInteger(Number(stake)) || Number(stake) <= 0} onClick={() => act('正在创建对局', () => client.createRoom(Number(stake)))}>创建对局</Button>
          <div className="form-divider"><span>或通过邀请码加入</span></div>
          <label className="sr-only" htmlFor="room-code">邀请码</label>
          <div className="join-row"><input id="room-code" autoComplete="off" placeholder="输入邀请码或邀请链接" value={room} onChange={(e) => setRoom(e.target.value)} disabled={busy}/>
            <button className="join-button" disabled={!state.ready || busy || !room.trim()} aria-label="加入对局" onClick={joinRoom}><Icon name="arrow" size={19}/></button></div>
        </div>
      ) : state.mode === 'ai' ? (
        <div className="room-info"><span className="section-kicker">VS LOCAL AI</span><p className="room-hint">你执{role}，对手是本机 AI。每一手都由你和 AI 对完整棋谱双签，链上不记录单步。</p><code title={state.channelId}>{state.channelId}</code></div>
      ) : !state.inviteUrl && state.mode !== 'demo' ? (
        <div className="room-info"><span className="section-kicker">INDEPENDENT EVIDENCE</span><p className="room-hint">独立证据恢复模式 · 无需中继。{isParticipant ? '你是本局参与者，可按状态使用链上操作。' : '当前钱包非本局参与者，仅可查看。'}</p><code title={state.channelId}>{state.channelId}</code></div>
      ) : state.mode === 'demo' ? (
        <div className="room-info"><span className="section-kicker">DEMO SESSION</span><p className="room-hint">脚本控制两个独立本地钱包，自动执黑与执白。此演示通道不使用双人邀请码。</p><code title={state.channelId}>{state.channelId}</code></div>
      ) : (
        <div className="room-info">
          <div className="room-id"><span>邀请码</span><CopyButton value={inviteCode} label="复制邀请码" compact onCopy={copy}/></div>
          <code title={inviteCode}>{inviteCode}</code>
          <Button icon="link" disabled={!state.inviteUrl} onClick={() => copy(state.inviteUrl, '复制邀请链接')}>复制邀请链接</Button>
          <p className="room-hint">{state.status === 'invited' ? '邀请另一浏览器打开链接，使用独立钱包加入。双方到齐后自动开通通道。' : `你执${role} · ${state.peerConnected ? '对手已连接' : '对手暂未连接'}`}</p>
        </div>
      )}
      {state.pending && (
        <div className="pending-box"><strong>有一手等待共同确认</strong><span>提案位置：{Math.floor(state.pending.position / 15) + 1} 行 {state.pending.position % 15 + 1} 列</span>
          {state.role > 0 && state.pending.by !== state.role && <Button icon="check" disabled={busy || !state.connected || state.persistence?.status === 'failed'} onClick={() => act('签名确认落子', () => client.acknowledge({ resend: true }))}>签名确认落子</Button>}</div>
      )}
      {state.terminal && state.status !== 'settled' && <Button kind="primary" icon="shield" disabled={busy || !state.ready || !isParticipant} onClick={() => act('正在链上结算', () => client.settle())}>链上结算本局</Button>}
      {state.status === 'settled' && <div className="settled-note"><Icon name="check" size={18}/>{result || '本局结束'} · 积分已链上结算</div>}
    </section>
  );
}
