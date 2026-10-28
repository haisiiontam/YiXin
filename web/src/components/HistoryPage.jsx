import React from 'react';
import { CopyButton, Empty, Icon, Transactions, formatTime, playerName, short } from './ui.jsx';
import { LEVELS } from '../../../shared/ai.mjs';

const MODE_TEXT = { demo: '自动演示 · ', player: '双人对局 · ' };

// 对局记录：来自当前浏览器保存的客户端快照，不是全网战绩。
export default function HistoryPage({ c }) {
  const { history, copy, exportCertificateById } = c;
  return (
    <section className="panel history-panel">
      <div className="section-header">
        <div><span className="section-kicker">YOUR LOCAL ARCHIVE</span><h2>对局记录</h2></div>
        <span className="status-chip">{history.length} 局</span>
      </div>
      {history.length ? (
        <div className="history-list">
          {history.map((item, index) => {
            const modeText = item.mode === 'ai' ? `人机对弈（${LEVELS[item.aiLevel]?.name || 'AI'}） · ` : MODE_TEXT[item.mode] || '';
            return (
              <article className="history-item" key={item.id || index}>
                <span className="history-symbol"><Icon name="board" size={25}/></span>
                <div className="history-main">
                  <strong>{item.winner ? `${playerName(item.winner)}获胜` : '和棋 / 未提供胜方'}</strong>
                  <code title={item.id}>{short(item.id, 10)}</code>
                  <small>{modeText}{item.settledAt ? formatTime(item.settledAt) : '结算时间未提供'}</small>
                </div>
                <div><strong>{item.movesCount ?? '—'} 手</strong><small>{Array.isArray(item.transactions) ? item.transactions.length : item.transactions ?? '—'} 笔链上交易</small></div>
                <div className="history-actions">
                  <CopyButton compact value={item.id} label={`复制历史通道ID ${index + 1}`} onCopy={copy}/>
                  <button type="button" className="icon-button" aria-label={`导出历史对局证书 ${index + 1}`} title="导出对局证书（SVG）" onClick={() => exportCertificateById(item)}><Icon name="stamp" size={16}/></button>
                </div>
                {Array.isArray(item.transactions) && <details className="history-transactions"><summary>查看本局交易</summary><Transactions items={item.transactions} onCopy={copy}/></details>}
              </article>
            );
          })}
        </div>
      ) : <Empty icon="clock" title="好棋，值得留下记录">完成一场对局并结算后，客户端保存的历史会显示在这里。当前浏览器暂无记录。</Empty>}
      <p className="footnote">记录来自当前本地钱包与客户端快照，不是全网战绩排行榜。</p>
    </section>
  );
}
