import React, { useMemo } from 'react';
import { evaluate } from '../../../shared/gomoku.mjs';
import { playerName } from './ui.jsx';

const COLS = Array.from({ length: 15 }, (_, i) => String.fromCharCode(65 + i));
const STARS = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]];

// 棋盘：每个交叉点都是原生按钮（键盘可达、读屏可读），棋子用 CSS 画出立体云子质感。
// moves 是“当前要显示的棋谱”（复盘时是前 k 手），与是否允许落子完全解耦。
export default function Board({ moves, pending, force, canMove, busy, onMove, winnerShown, hints, threats, showNumbers, reviewing }) {
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
      <div className="board" aria-label="15乘15五子棋棋盘" aria-busy={busy}>
        <svg className="board-lines" viewBox="0 0 600 600" aria-hidden="true">
          {Array.from({ length: 15 }, (_, i) => <path key={i} d={`M20 ${20 + i * 40}H580M${20 + i * 40} 20V580`}/>)}
          {STARS.map(([r, c]) => <circle key={`${r}-${c}`} cx={20 + c * 40} cy={20 + r * 40} r="3.6"/>)}
        </svg>
        {Array.from({ length: 225 }, (_, p) => {
          const index = occupied.get(p);
          const hasStone = index !== undefined;
          const isPending = !force && !reviewing && pending?.position === p && !hasStone;
          const color = hasStone ? (index % 2 === 0 ? 'black' : 'white') : isPending ? (pending.by === 1 ? 'black' : 'white') : '';
          const cls = ['intersection', hasStone && 'occupied', isPending && 'is-pending', winning.has(p) && 'winning', hints?.has(p) && 'is-hint', threats?.has(p) && 'is-threat'].filter(Boolean).join(' ');
          const description = hasStone ? `第${index + 1}手，${playerName(index % 2 + 1)}` : isPending ? '等待双方确认' : force ? '链上强制落子' : hints?.has(p) ? '推荐落点' : threats?.has(p) ? '需要留意的威胁点' : '空位';
          return (
            <button key={p} type="button" className={cls} aria-label={`落子 ${Math.floor(p / 15) + 1},${p % 15 + 1}`} aria-description={description}
              disabled={!canMove || hasStone || isPending} onClick={() => onMove(p)}>
              {(hasStone || isPending) && (
                <span className={`stone ${color} ${isPending ? 'pending' : ''}`}>
                  {showNumbers && hasStone && <b className="stone-no">{index + 1}</b>}
                  {hasStone && p === latest && <span className="last-move"/>}
                  {isPending && <span className="pending-dot"/>}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
