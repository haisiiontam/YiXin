import React, { useId, useMemo, useState } from 'react';
import { evaluate } from '../../../shared/gomoku.mjs';
import { playerName } from './ui.jsx';

const COLS = Array.from({ length: 15 }, (_, i) => String.fromCharCode(65 + i));
const STARS = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]];

// 棋盘：每个交叉点都是原生按钮（键盘可达、读屏可读），棋子用 CSS 画出立体云子质感。
// moves 是“当前要显示的棋谱”（复盘时是前 k 手），与是否允许落子完全解耦。
export default function Board({ moves, pending, force, canMove, busy, onMove, winnerShown, hints, threats, showNumbers, reviewing }) {
  const id = useId(), [cursor, setCursor] = useState(112);
  function navigate(event) {
    if (event.target !== event.currentTarget) return;
    let next = cursor;
    const row = Math.floor(cursor / 15), col = cursor % 15;
    if (event.key === 'ArrowLeft') next = row * 15 + Math.max(0, col - 1);
    else if (event.key === 'ArrowRight') next = row * 15 + Math.min(14, col + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, row - 1) * 15 + col;
    else if (event.key === 'ArrowDown') next = Math.min(14, row + 1) * 15 + col;
    else if (event.key === 'Home') next = event.ctrlKey ? 0 : row * 15;
    else if (event.key === 'End') next = event.ctrlKey ? 224 : row * 15 + 14;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (canMove && !occupied.has(cursor) && pending?.position !== cursor) onMove(cursor);
      return;
    } else return;
    event.preventDefault(); setCursor(next);
  }
  const occupied = useMemo(() => new Map(moves.map((p, i) => [Number(p), i])), [moves]);
  const latest = moves.at(-1);
  // 胜线直接取规则引擎的结果，保证和合约判定同源。
  const winning = useMemo(() => {
    if (!winnerShown) return new Set();
    try { return new Set(evaluate(moves).winningLine); } catch { return new Set(); }
  }, [moves, winnerShown]);
  return (
    <div className={`board-frame ${canMove ? 'your-turn' : ''} ${reviewing ? 'is-reviewing' : ''}`}>
      <div className="board-coordinates top" aria-hidden="true">{COLS.map((c) => <span key={c}>{c}</span>)}</div>
      <div className="board-coordinates left" aria-hidden="true">{Array.from({ length: 15 }, (_, i) => <span key={i}>{i + 1}</span>)}</div>
      <div className="board" role="grid" tabIndex={0} aria-rowcount={15} aria-colcount={15} aria-label="15乘15五子棋棋盘" aria-describedby={`${id}-help`} aria-activedescendant={`${id}-cell-${cursor}`} aria-busy={busy} onKeyDown={navigate}>
        <svg className="board-lines" viewBox="0 0 600 600" aria-hidden="true">
          {Array.from({ length: 15 }, (_, i) => <path key={i} d={`M20 ${20 + i * 40}H580M${20 + i * 40} 20V580`}/>)}
          {STARS.map(([r, c]) => <circle key={`${r}-${c}`} cx={20 + c * 40} cy={20 + r * 40} r="3.6"/>)}
        </svg>
        {Array.from({ length: 15 }, (_, row) => <div className="board-row" role="row" key={row}>{Array.from({ length: 15 }, (_, col) => {
          const p = row * 15 + col;
          const index = occupied.get(p);
          const hasStone = index !== undefined;
          const isPending = !force && !reviewing && pending?.position === p && !hasStone;
          const color = hasStone ? (index % 2 === 0 ? 'black' : 'white') : isPending ? (pending.by === 1 ? 'black' : 'white') : '';
          const cls = ['intersection', cursor === p && 'is-keyboard-active', hasStone && 'occupied', isPending && 'is-pending', winning.has(p) && 'winning', hints?.has(p) && 'is-hint', threats?.has(p) && 'is-threat'].filter(Boolean).join(' ');
          const description = hasStone ? `第${index + 1}手，${playerName(index % 2 + 1)}` : isPending ? '等待双方确认' : force ? '链上强制落子' : hints?.has(p) ? '推荐落点' : threats?.has(p) ? '需要留意的威胁点' : '空位';
          return (
            <div className="board-cell" role="gridcell" id={`${id}-cell-${p}`} key={p} aria-rowindex={row + 1} aria-colindex={col + 1} aria-label={`${COLS[col]}${row + 1}，${description}`}>
            <button tabIndex={-1} type="button" className={cls} aria-label={`落子 ${Math.floor(p / 15) + 1},${p % 15 + 1}`} aria-description={description}
              disabled={!canMove || hasStone || isPending} onClick={() => { setCursor(p); onMove(p); }}>
              {(hasStone || isPending) && (
                <span className={`stone ${color} ${isPending ? 'pending' : ''}`}>
                  {showNumbers && hasStone && <b className="stone-no">{index + 1}</b>}
                  {hasStone && p === latest && <span className="last-move"/>}
                  {isPending && <span className="pending-dot"/>}
                </span>
              )}
            </button></div>
          );
        })}</div>)}
      </div>
      <p className="board-keyboard-help" id={`${id}-help`}>键盘：Tab 进入棋盘，方向键选点，Enter / 空格落子，Home / End 移至行首尾。可逐点查看已落棋子。</p>
    </div>
  );
}
