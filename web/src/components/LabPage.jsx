import React from 'react';
import { Button, CopyButton, Empty, Icon, Metric, Transactions } from './ui.jsx';

// 通道实验室：用真实交易和已确认棋谱对比“逐步上链”基线（FR-21/22）。
export default function LabPage({ c }) {
  const { state, busy, act, moves, txs, hasRoom, savings, exportEvidence, copy } = c;
  const baseline = moves.length + 2;
  const scale = Math.max(baseline, txs.length, 1);
  return (
    <div className="lab-layout">
      <section className="panel lab-main">
        <div className="section-header">
          <div><span className="section-kicker">STATE CHANNEL INSIGHTS</span><h2>把每一步，留在链下</h2></div>
          <span className="status-chip">{state.status === 'settled' ? '已结算数据' : '当前快照'}</span>
        </div>
        <p className="section-description">以下数字来自当前客户端的真实交易与已确认棋谱。未完局会随开通、争议和结算继续变化。</p>
        <div className="metrics-grid">
          <Metric label="已确认落子 m" value={moves.length} note="完整已确认棋谱"/>
          <Metric label="本局实际链上交易" value={txs.length} note="open / join / 结算 / 争议" tone="accent"/>
          <Metric label="逐步上链基线" value={hasRoom ? baseline : '—'} note="m + 2：开通 + 加入 + 每手"/>
          <Metric label="相对基线减少" value={hasRoom && moves.length ? `${savings}%` : '—'} note={state.status === 'settled' ? '已结算快照对照' : '当前快照，非最终结果'}/>
        </div>
        {hasRoom ? (
          <div className="comparison">
            <div><span>逐步上链基线</span><div className="bar-track"><i style={{ width: `${(baseline / scale) * 100}%` }}/></div><strong>{baseline} 笔</strong></div>
            <div><span>当前通道实际</span><div className="bar-track green"><i style={{ width: `${(txs.length / scale) * 100}%` }}/></div><strong>{txs.length} 笔</strong></div>
          </div>
        ) : <Empty title="等待第一局真实数据">创建双人房间、人机对弈或运行完整自动演示，交易确认后在这里查看。</Empty>}
        <div className="method-note"><Icon name="info" size={18}/><p>正常已注册玩家每局通常为 open + join + settle 共 3 笔。基线按最后一手同时结算计 m + 2 笔。争议、强制落子会增加交易；未结束局的比较仅代表当前快照，不代表最终节省。</p></div>
        <div className="section-header transactions-heading"><h3>本局真实交易</h3><span className="muted">{txs.length} 笔</span></div>
        <Transactions items={txs} onCopy={copy}/>
      </section>
      <aside className="lab-side">
        <section className="panel">
          <span className="section-kicker">VERIFIABLE BY DESIGN</span>
          <h3>一份状态，两个签名</h3>
          <div className="protocol-steps">
            <div><span>01</span><div><strong>开通通道</strong><p>双方各锁定 {state.stake || 10} 演示积分</p></div></div>
            <div><span>02</span><div><strong>链下轮流签名</strong><p>双方校验完整棋谱，确认每次更新</p></div></div>
            <div><span>03</span><div><strong>提交终局结算</strong><p>合约验证双签与棋谱，分配积分</p></div></div>
          </div>
          <Button icon="download" disabled={busy || !hasRoom} onClick={() => act('导出证据快照', exportEvidence)}>导出当前证据 JSON</Button>
        </section>
        <section className="panel initialization">
          <h3>初始化 · 单独计量</h3>
          <p>合约部署、账户注册与初始积分发行属于初始化，不计入每局交易。</p>
          <p>下方仅列当前客户端实际执行的注册 receipt；合约部署与其他账户的初始化，以原始运行记录为准。</p>
          {(state.initialization || []).length ? <Transactions items={state.initialization} onCopy={copy} labelPrefix="初始化交易"/> : <p>当前会话没有新的注册交易。已注册钱包不会重复注册。</p>}
          <dl>
            <dt>网络</dt><dd>{state.networkName}</dd>
            <dt>Chain ID</dt><dd>{state.chainId}</dd>
            <dt>合约</dt><dd className="break-all">{state.contractAddress || '等待初始化'}{state.contractAddress && <CopyButton compact value={state.contractAddress} label="复制合约地址" onCopy={copy}/>}</dd>
            <dt>本局累计 gas</dt><dd>{state.metrics.totalGas ?? '—'}</dd>
          </dl>
        </section>
        <details className="panel raw-state">
          <summary>签名域与状态摘要</summary>
          <p>GomokuChannel · version 1<br/>chainId + verifyingContract + channelId + movesHash</p>
          <label>当前状态 digest</label><code>{state.digest || '暂无签名快照'}</code>
          <CopyButton value={state.digest} label="复制状态摘要" onCopy={copy}/>
        </details>
      </aside>
    </div>
  );
}
