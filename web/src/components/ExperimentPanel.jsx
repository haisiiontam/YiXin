import React from 'react';
import { Button, Icon, Transactions } from './ui.jsx';

// 签名与异常实验：拒签、争议、强制落子、超时结算、证据导出与导入。
// 控件名称与旧版一致（端到端脚本按名称定位）。
export default function ExperimentPanel({ c }) {
  const { state, client, busy, act, txs, hasRoom, isParticipant, force, setForce, countdown, exportEvidence, importEvidenceFile, importResult, copy } = c;
  return (
    <details className="panel experiment-panel">
      <summary><span><Icon name="layers" size={17}/> 签名与异常实验</span><Icon name="chevron" size={16}/></summary>
      <p className="small-description">正常对弈无须链上逐步落子；对手离线或拒签时，可进入争议并在窗口内提交最新证据。</p>
      <div className="signature-summary"><span>黑方签名 <b>{state.signatures.black ? '已保存' : '暂无'}</b></span><span>白方签名 <b>{state.signatures.white ? '已保存' : '暂无'}</b></span></div>
      <details className="evidence-details">
        <summary>查看完整双签与摘要</summary>
        <label>黑方 EIP-712 签名</label><code>{state.signatures.black || '尚无黑方签名'}</code>
        <label>白方 EIP-712 签名</label><code>{state.signatures.white || '尚无白方签名'}</code>
        <label>状态 digest</label><code>{state.digest || '尚无双签状态'}</code>
        <p>签名绑定链、合约、对局与完整棋谱，导出证据可保存原文。</p>
      </details>
      <details className="evidence-details">
        <summary>本局真实交易 · {txs.length} 笔</summary>
        <Transactions items={txs} onCopy={copy}/>
      </details>
      <label className="switch-row"><span>自动确认对手提案</span><input type="checkbox" checked={state.autoAck} disabled={busy} onChange={(e) => act('更新确认设置', () => client.setAutoAck(e.target.checked))}/></label>
      <Button icon="shield" disabled={busy || !isParticipant || !['active', 'dispute'].includes(state.status) || state.mode === 'ai'} onClick={() => act('提交双签快照挑战', () => client.challenge())}>提交最新快照挑战</Button>
      {state.status === 'dispute' && <>
        <div className="deadline" role="status">{countdown > 0 ? `争议窗口剩余 ${countdown} 秒` : '争议窗口已到期'}</div>
        <label className="switch-row"><span>棋盘使用链上强制落子</span><input type="checkbox" checked={force} disabled={busy} onChange={(e) => setForce(e.target.checked)}/></label>
        <Button disabled={busy || !isParticipant || countdown > 0} onClick={() => act('领取超时结算', () => client.claimTimeout())}>领取超时结算</Button>
      </>}
      {state.status === 'invited' && <Button disabled={busy || state.role !== 1 || !state.deadline || countdown > 0} onClick={() => act('取消未加入邀请', () => client.cancelUnjoined())}>到期取消未加入邀请</Button>}
      <Button icon="download" disabled={busy || !hasRoom} onClick={() => act('导出证据快照', exportEvidence)}>导出证据 JSON</Button>
      <div className="evidence-import">
        <label htmlFor="evidence-file">从文件恢复已签状态</label>
        <input id="evidence-file" type="file" accept="application/json,.json" aria-label="导入证据 JSON" disabled={busy || !state.ready} onChange={importEvidenceFile}/>
        <p>导出证据不含私钥。RPC 可用时，无需中继即可验证并恢复；当前钱包若非对局参与者，仅可查看。</p>
        {importResult?.channelId === state.channelId && (
          <div className="import-result" role="status">
            <strong><Icon name="check" size={14}/> 证据验证通过</strong>
            <span>{importResult.fileName}</span>
            <span>合法棋谱 {importResult.movesCount} 手 · 已核验 {importResult.receiptCount} 笔交易 receipt</span>
            <span>格式、签名域、棋谱与链上参与者 / 积分已验证，非空谱双签已核验。</span>
            <label>已验证状态 digest</label><code>{importResult.digest}</code>
            <span>{isParticipant ? '当前钱包为本局参与者，可按通道状态使用链上操作。' : '当前钱包非参与者，仅查看已恢复状态。'}</span>
          </div>
        )}
      </div>
      <div className="two-buttons">
        <Button icon="refresh" disabled={busy} onClick={() => act(state.ready ? '刷新状态' : '重新连接本地服务', () => state.ready ? client.refresh() : client.init())}>{state.ready ? '刷新状态' : '重新连接'}</Button>
        <Button disabled={busy || !state.connected} onClick={() => act('断开中继连接', () => client.disconnect())}>断开中继</Button>
      </div>
      <p className="small-description">关闭自动确认可模拟拒签；断开中继后可尝试 RPC 争议路径。恢复连接请刷新页面。诚实方需要在争议窗口内在线响应。</p>
    </details>
  );
}
