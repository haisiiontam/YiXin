import React from 'react';
import { recoveryGuide } from '../../../shared/recovery-guide.mjs';
import { Button, Icon } from './ui.jsx';

export default function RecoveryPanel({ c }) {
  const { state, client, busy, act, exportEvidence } = c;
  if (!state.channelId) return null;
  const guide = recoveryGuide(state), saved = state.persistence?.status === 'saved';
  const signed = state.signatures?.black && state.signatures?.white;
  return <section className={`panel recovery-panel ${guide.tone}`} aria-label="对局安心助手" data-guide-stage={guide.stage}>
    <div className="panel-title"><h2><Icon name="shield" size={18}/> 对局安心助手</h2></div>
    <div className="recovery-facts" aria-label="证据保存状态">
      <span>{saved ? '本地保存已核对' : '本地保存待完成'}</span>
      <span>{signed ? `双方已签 ${state.persistence?.movesCount ?? state.moves.length} 手` : '空谱或暂无双签'}</span>
      <span>{state.transactionListComplete ? '节点交易清单已核验' : '交易清单待核验'}</span>
    </div>
    <h3>{guide.title}</h3><p>{guide.detail}</p>
    <ol>{guide.steps.map(step => <li key={step}>{step}</li>)}</ol>
    <div className="recovery-actions">
      <Button icon="download" disabled={busy} onClick={() => act('备份本局证据', exportEvidence)}>备份本局证据</Button>
      {guide.stage === 'storage' && <Button kind="primary" disabled={busy} onClick={() => act('重试本地保存', () => client.retryCheckpointSave())}>重试本地保存</Button>}
      {!state.connected && state.ready && state.mode === 'player' && state.inviteUrl && <Button icon="refresh" disabled={busy} onClick={() => act('重连原房间', () => client.reconnectRelay())}>重连原房间</Button>}
      {state.mode === 'ai' && saved && state.status === 'active' && !state.terminal && !state.aiThinking && state.nextPlayer !== state.role && <Button disabled={busy} onClick={() => act('继续 AI 回合', () => client.continueAiTurn())}>继续 AI 回合</Button>}
    </div>
    <a href="#channel-experiments" onClick={() => { const node = document.getElementById('channel-experiments'); if (node) node.open = true; }}>打开签名与异常实验 →</a>
  </section>;
}
