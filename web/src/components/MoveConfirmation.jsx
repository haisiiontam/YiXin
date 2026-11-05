import React, { useEffect, useRef } from 'react';
import { Button } from './ui.jsx';

// Cancellation is meaningful only before signing. Confirmed protocol moves are
// immutable; this preview therefore never invokes the controller on selection.
export default function MoveConfirmation({ position, force, onConfirm, onCancel }) {
  const dialog = useRef();
  useEffect(() => {
    const node = dialog.current, previous = document.activeElement;
    node.showModal();
    return () => { node.close(); previous?.focus(); };
  }, []);
  const coordinate = `${String.fromCharCode(65 + position % 15)}${Math.floor(position / 15) + 1}`;
  return <dialog ref={dialog} className="move-confirmation" aria-labelledby="move-confirm-title" aria-describedby="move-confirm-detail" onCancel={e => { e.preventDefault(); onCancel(); }}>
    <h2 id="move-confirm-title">确认落在 {coordinate}？</h2>
    <p id="move-confirm-detail">{Math.floor(position / 15) + 1} 行 {position % 15 + 1} 列。{force ? '确认后将请求链上交易，可能消耗 gas。' : '确认后才会签名并发送提案；双方确认后无法撤回。'}</p>
    <div className="recovery-actions"><Button autoFocus onClick={onCancel}>返回棋盘</Button><Button kind="primary" onClick={onConfirm}>确认落子 {coordinate}</Button></div>
  </dialog>;
}
