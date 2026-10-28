import React from 'react';

// 统一的线性图标集：24×24、1.65 描边，跟随 currentColor，便于日夜主题切换。
const PATHS = {
  board: <><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 4v16M15 4v16M4 9h16M4 15h16"/></>,
  layers: <path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></>,
  wallet: <><path d="M20 8V5H5a2 2 0 0 0 0 4h15v11H5a2 2 0 0 1-2-2V7"/><path d="M20 12h-5v4h5"/></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
  play: <path d="m8 4 12 8-12 8V4Z"/>,
  pause: <path d="M8 5v14M16 5v14"/>,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 8a7 7 0 0 1 11-3l3 3M4 16l3 3a7 7 0 0 0 11-3"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  link: <path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-5-5l4-4a4 4 0 0 1 6 0M12 16a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1"/>,
  chevron: <path d="m9 5 7 7-7 7"/>,
  bolt: <path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>,
  volume: <><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></>,
  mute: <><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="m17 9 5 6M22 9l-5 6"/></>,
  bulb: <><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z"/></>,
  robot: <><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V4M9 13h.01M15 13h.01M9.5 16.5h5"/></>,
  stamp: <><path d="M9 4h6v6l3 3v2H6v-2l3-3V4ZM5 19h14"/></>,
  rewind: <path d="M11 6 4 12l7 6V6Zm9 0-7 6 7 6V6Z"/>,
  forward: <path d="m13 6 7 6-7 6V6ZM4 6l7 6-7 6V6Z"/>,
};

export function Icon({ name, size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[name] || PATHS.info}</svg>;
}

export function Button({ children, icon, kind = 'secondary', className = '', ...props }) {
  return <button className={`button ${kind} ${className}`} {...props}>{icon && <Icon name={icon} size={17}/>}<span>{children}</span></button>;
}

export function CopyButton({ value, label, onCopy, compact = false }) {
  return <button type="button" className={compact ? 'icon-button' : 'copy-button'} disabled={!value} aria-label={label} title={label} onClick={() => onCopy(value, label)}><Icon name="copy" size={15}/>{!compact && <span>{label}</span>}</button>;
}

export function Empty({ icon = 'board', title, children }) {
  return <div className="empty"><span className="empty-icon"><Icon name={icon} size={26}/></span><h3>{title}</h3><p>{children}</p></div>;
}

export function Metric({ label, value, note, tone }) {
  return <div className={`metric ${tone || ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

export const short = (s, n = 6) => s ? `${s.slice(0, n + 2)}…${s.slice(-4)}` : '尚未连接';
export const playerName = (n) => n === 1 ? '黑方' : n === 2 ? '白方' : '和棋';

export function formatTime(value) {
  const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
}

export function Transactions({ items, onCopy, labelPrefix = '交易' }) {
  if (!items.length) return <p className="muted empty-line">暂无本局链上交易。创建房间不会立即产生交易。</p>;
  return <div className="tx-list">{items.map((tx, i) => (
    <div className="tx-row" key={`${tx.hash}-${i}`}>
      <span className="tx-mark"><Icon name="check" size={14}/></span>
      <div><strong>{tx.label || '链上交易'}</strong><span title={tx.hash}>{short(tx.hash, 10)}</span></div>
      <div className="tx-gas"><span>{String(tx.gasUsed ?? '—')} gas</span><small>区块 {tx.blockNumber ?? '—'}</small></div>
      <CopyButton compact value={tx.hash} label={`复制${labelPrefix}hash ${i + 1}`} onCopy={onCopy}/>
    </div>
  ))}</div>;
}
