import React, { useEffect, useMemo, useRef, useState } from 'react';
import { evaluationCurve, positionLabel } from '../../../shared/analysis.mjs';
import { explainMove } from '../../../shared/ai.mjs';
import { Icon, Button, playerName } from './ui.jsx';

const W = 600;
const H = 90;
const MID = H / 2;

// 形势曲线：中线以上黑方占优，以下白方占优；竖虚线标出当前复盘到的那一手。
function Curve({ values, cursor }) {
  const n = values.length;
  const x = (i) => (n === 1 ? W / 2 : (i * W) / (n - 1));
  const y = (v) => MID - v * (MID - 6);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  const area = n ? `M${x(0).toFixed(1)} ${MID}${values.map((v, i) => `L${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('')}L${x(n - 1).toFixed(1)} ${MID}Z` : '';
  return (
    <svg className="curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="形势曲线：中线以上黑方占优，以下白方占优">
      <line className="axis" x1="0" x2={W} y1={MID} y2={MID}/>
      {n > 0 && <path className="area-black" d={area}/>}
      {n > 0 && <path className="line" d={line}/>}
      {cursor >= 0 && cursor < n && <line className="cursor" x1={x(cursor)} x2={x(cursor)} y1="0" y2={H}/>}
    </svg>
  );
}

// 复盘面板：回看任意一手、自动播放、形势曲线与点评，以及棋局辅助开关。
// 复盘只改变“显示哪一手”，不会发送任何签名或交易（FR-28）。
export default function ReviewPanel({ moves, reviewIndex, onReview, showNumbers, onShowNumbers, showThreats, onShowThreats, canHint, onHint, hintList }) {
  const [playing, setPlaying] = useState(false);
  const shown = reviewIndex ?? moves.length;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const key = moves.join(',');
  const curve = useMemo(() => (moves.length ? evaluationCurve(moves) : []), [key]);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => {
      const next = shownRef.current + 1;
      if (next >= moves.length) { onReview(null); setPlaying(false); } else onReview(next);
    }, 700);
    return () => clearInterval(timer);
  }, [playing, moves.length, onReview]);

  const last = shown > 0 ? moves[shown - 1] : null;
  const advantage = shown > 0 ? curve[shown - 1] ?? 0 : 0;
  const side = advantage > 0.05 ? '黑优' : advantage < -0.05 ? '白优' : '均势';
  const comment = last == null ? '尚未落子。开始对局后，这里会逐手点评。'
    : `第 ${shown} 手 · ${playerName((shown - 1) % 2 + 1)} ${positionLabel(last)} · ${explainMove(moves.slice(0, shown), last)}`;

  function togglePlay() {
    if (playing) { setPlaying(false); return; }
    if (shown >= moves.length) onReview(0);
    setPlaying(true);
  }
  const go = (i) => { setPlaying(false); onReview(i >= moves.length ? null : Math.max(0, i)); };

  return (
    <section className="panel review-panel" aria-label="复盘与局势">
      <div className="panel-title"><h2>复盘 · 局势</h2><span className="muted">{reviewIndex == null ? '正在显示最新局面' : `回看中 · 第 ${shown} 手`}</span></div>
      <div className="review-controls">
        <button type="button" className="tool-button" aria-label="回到开局" disabled={!moves.length} onClick={() => go(0)}><Icon name="rewind" size={16}/></button>
        <button type="button" className="tool-button" aria-label="上一手" disabled={!moves.length || shown <= 0} onClick={() => go(shown - 1)}><Icon name="chevron" size={16}/></button>
        <input className="review-slider" type="range" min="0" max={moves.length} value={shown} disabled={!moves.length} aria-label="复盘手数" onChange={(e) => go(Number(e.target.value))}/>
        <button type="button" className="tool-button" aria-label="下一手" disabled={!moves.length || shown >= moves.length} onClick={() => go(shown + 1)}><Icon name="arrow" size={16}/></button>
        <button type="button" className="tool-button" aria-label={playing ? '暂停播放' : '自动播放'} disabled={moves.length < 2} onClick={togglePlay}><Icon name={playing ? 'pause' : 'play'} size={16}/></button>
        <button type="button" className="tool-button" aria-label="回到最新" disabled={reviewIndex == null} onClick={() => go(moves.length)}><Icon name="forward" size={16}/></button>
        <span className="review-count">{shown} / {moves.length}</span>
      </div>
      <p className="review-comment" role="status">{comment}</p>
      {curve.length > 0 && <><Curve values={curve} cursor={shown - 1}/><div className="curve-caption"><span>↑ 黑方占优</span><span>当前局势：{side} {Math.round(Math.abs(advantage) * 100)}%</span><span>↓ 白方占优</span></div></>}
      <div className="tool-row">
        <label className="switch-row"><span>显示手数</span><input type="checkbox" checked={showNumbers} onChange={(e) => onShowNumbers(e.target.checked)}/></label>
        <label className="switch-row"><span>标出威胁</span><input type="checkbox" checked={showThreats} onChange={(e) => onShowThreats(e.target.checked)}/></label>
        <Button icon="bulb" disabled={!canHint} onClick={onHint}>给我提示</Button>
      </div>
      {hintList.length > 0 && <div className="hint-list"><ol>{hintList.map((h, i) => <li key={h.position}><b>{i + 1}. {positionLabel(h.position)}</b> · {h.reason}</li>)}</ol></div>}
    </section>
  );
}
