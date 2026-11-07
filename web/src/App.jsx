import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChannelClient } from './channel-client.js';
import { analyzePosition } from '../../shared/analysis.mjs';
import { LEVELS, suggestMoves } from '../../shared/ai.mjs';
import { buildCertificateSvg, certificateFileName } from '../../shared/certificate.mjs';
import { setSoundEnabled, playStone, playWin, playDraw, playSettle } from './sound.js';
import { Button, CopyButton, Icon, playerName, short } from './components/ui.jsx';
import Board from './components/Board.jsx';
import MatchPanel from './components/MatchPanel.jsx';
import AiPanel from './components/AiPanel.jsx';
import ReviewPanel from './components/ReviewPanel.jsx';
import ExperimentPanel from './components/ExperimentPanel.jsx';
import LabPage from './components/LabPage.jsx';
import HistoryPage from './components/HistoryPage.jsx';
import AboutPage from './components/AboutPage.jsx';
import RecoveryPanel from './components/RecoveryPanel.jsx';
import MoveConfirmation from './components/MoveConfirmation.jsx';

const client = new ChannelClient();
const EMPTY = { ready: false, busy: false, error: '', mode: 'player', address: '', points: 0, chainId: 31337, contractAddress: '', channelId: '', inviteUrl: '', role: 0, black: '', white: '', stake: 10, status: 'idle', moves: [], pending: null, winner: 0, terminal: false, reason: '', nextPlayer: 1, deadline: 0, challengePeriod: 60, now: 0, connected: false, peerConnected: false, autoAck: true, signatures: {}, digest: '', transactions: [], events: [], history: [], initialization: [], demoProgress: '', aiLevel: '', aiThinking: false, metrics: {}, networkName: 'Gomoku Local EVM' };
const NAV = [{ id: 'lobby', icon: 'board', text: '对局大厅' }, { id: 'lab', icon: 'layers', text: '通道实验室' }, { id: 'history', icon: 'clock', text: '对局记录' }, { id: 'about', icon: 'info', text: '项目说明' }];
const STATUS = { idle: '尚未开始', invited: '等待对手加入', active: '对局进行中', dispute: '链上争议中', settled: '已完成结算', cancelled: '邀请已取消' };
const HEADINGS = {
  lobby: ['落子之间，信任自现。', '一场五子棋，体验链下对弈与链上结算的默契。'],
  lab: ['让信任，看得见。', '从真实快照出发，观察状态通道如何减少链上交互。'],
  history: ['每一局，都有迹可循。', '回看已保存的本地对局与真实交易记录。'],
  about: ['一盘棋，一个通道。', '用可验证的数字签名，连接流畅对弈与可信结算。'],
};
const store = {
  get: (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
  set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* 隐私模式下忽略 */ } },
};

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [state, setState] = useState(EMPTY), [tab, setTab] = useState('lobby'), [localBusy, setLocalBusy] = useState(''), [error, setError] = useState(''), [toast, setToast] = useState('');
  const [stake, setStake] = useState('10'), [room, setRoom] = useState(() => new URLSearchParams(window.location.search).get('room') || ''), [force, setForce] = useState(false), [importResult, setImportResult] = useState(null);
  const [theme, setTheme] = useState(() => store.get('gomoku-theme', 'light')), [sound, setSound] = useState(() => store.get('gomoku-sound', 'on') !== 'off');
  const [reviewIndex, setReviewIndex] = useState(null), [showNumbers, setShowNumbers] = useState(false), [showThreats, setShowThreats] = useState(false), [hintList, setHintList] = useState([]);
  const [aiLevel, setAiLevel] = useState('adept'), [aiSide, setAiSide] = useState(1);
  const [confirmMove, setConfirmMove] = useState(() => store.get('gomoku-confirm-move', window.matchMedia('(pointer: coarse)').matches ? 'on' : 'off') === 'on');
  const [draftMove, setDraftMove] = useState(null);
  const toastTimer = useRef(), lastClientError = useRef(''), prevMoves = useRef(null), prevTerminal = useRef(false), prevStatus = useRef('idle');

  useEffect(() => {
    const off = client.subscribe((next) => {
      setState({ ...EMPTY, ...next, signatures: next.signatures || {}, metrics: next.metrics || {} });
      if (next.error !== lastClientError.current) {
        lastClientError.current = next.error || '';
        if (next.error) setError(next.error);
      }
    });
    client.init().catch((e) => setError(e.message || String(e)));
    return () => { off?.(); clearTimeout(toastTimer.current); client.destroy?.(); };
  }, []);

  // 主题与音效偏好：写入 localStorage，下次打开保持一致。
  useEffect(() => { document.documentElement.dataset.theme = theme; store.set('gomoku-theme', theme); }, [theme]);
  useEffect(() => { setSoundEnabled(sound); store.set('gomoku-sound', sound ? 'on' : 'off'); }, [sound]);
  useEffect(() => { store.set('gomoku-confirm-move', confirmMove ? 'on' : 'off'); }, [confirmMove]);
  useEffect(() => { setDraftMove(null); }, [state.channelId, state.moves?.join(','), state.status, state.role, state.nextPlayer, force, reviewIndex]);

  const busy = Boolean(state.busy || localBusy), moves = state.moves || [], txs = state.transactions || [], history = state.history || [];
  const external = state.networkMode === 'external';
  const hasRoom = Boolean(state.channelId), finished = state.status === 'settled' || state.status === 'cancelled';
  const isMyTurn = state.role === state.nextPlayer, isParticipant = state.role === 1 || state.role === 2;
  const canMove = state.ready && isParticipant && state.persistence?.status !== 'failed' && !busy && !state.aiThinking && !state.terminal && state.mode !== 'demo' && reviewIndex == null && isMyTurn
    && ((state.status === 'active' && !state.pending && (state.mode === 'ai' || (state.connected && state.peerConnected))) || (state.status === 'dispute' && force && Number.isFinite(state.chainNow) && !state.chainError && state.chainNow >= Number(state.proofDeadline || 0) && Number(state.deadline) > state.chainNow));
  const inviteCode = state.inviteUrl ? new URL(state.inviteUrl, window.location.href).searchParams.get('room') || state.channelId : state.channelId;
  const role = state.role ? playerName(state.role) : '访客';
  const result = state.terminal ? state.winner ? `${playerName(state.winner)}获胜` : '本局和棋' : '';
  const countdown = Math.max(0, Number(state.deadline || 0) - Number(state.now || 0));
  const savings = moves.length ? Math.round((1 - txs.length / (moves.length + 2)) * 100) : 0;

  // 复盘：只改变“显示哪几手”，棋局状态与签名完全不动。
  const shownMoves = reviewIndex == null ? moves : moves.slice(0, reviewIndex);
  const analysis = useMemo(() => {
    if (!showThreats && !hintList.length) return null;
    try { return analyzePosition(shownMoves); } catch { return null; }
  }, [showThreats, hintList.length, shownMoves.join(',')]);
  const threatCells = useMemo(() => {
    if (!showThreats || !analysis || (state.terminal && reviewIndex == null)) return null;
    return new Set([...analysis.winningCells[1], ...analysis.winningCells[2], ...analysis.mustBlock]);
  }, [showThreats, analysis, state.terminal, reviewIndex]);
  const hintCells = useMemo(() => (reviewIndex == null && hintList.length ? new Set(hintList.map((h) => h.position)) : null), [hintList, reviewIndex]);

  // 手数变化时清掉过期提示；新落子播放音效；终局播放胜负音。
  useEffect(() => {
    setHintList([]);
    if (prevMoves.current !== null && moves.length > prevMoves.current && moves.length > 0) playStone((moves.length - 1) % 2 + 1);
    prevMoves.current = moves.length;
    if (moves.length === 0) setReviewIndex(null);
  }, [moves.length]);
  useEffect(() => {
    if (state.terminal && !prevTerminal.current) (state.winner ? playWin : playDraw)();
    prevTerminal.current = state.terminal;
  }, [state.terminal, state.winner]);
  useEffect(() => {
    if (state.status === 'settled' && prevStatus.current !== 'settled' && prevStatus.current !== 'idle') playSettle();
    prevStatus.current = state.status;
  }, [state.status]);

  const announce = (text) => { setToast(text); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 3500); };
  async function act(label, action) { if (busy) return; setError(''); setLocalBusy(label); try { await action(); } catch (e) { setError(e.message || String(e)); } finally { setLocalBusy(''); } }
  function legacyCopy(text) { const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0'; document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length); let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; } document.body.removeChild(ta); return ok; }
  async function copy(value, label) {
    const text = value == null ? '' : String(value);
    if (!text) { setError('没有可复制的内容。'); return; }
    const name = String(label || '内容').replace('复制', '');
    try {
      if (navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(text); announce(`${name}已复制`); return; } catch { /* 交给下面的兼容方案 */ }
      }
      if (legacyCopy(text)) { announce(`${name}已复制（兼容模式）`); return; }
      window.prompt('浏览器禁止了自动复制，请按 Ctrl+C 复制：', text);
      setError('自动复制被浏览器拦截，已弹出文本框，请手动复制。');
    } catch (e) { setError((e && e.message) || '复制失败'); }
  }
  async function exportEvidence() {
    const evidence = await client.exportEvidence();
    download(`gomoku-evidence-${state.channelId || 'snapshot'}.json`, JSON.stringify(evidence, null, 2), 'application/json');
    announce('证据快照已导出');
  }
  // 对局证书：先用 verifyEvidence 核验双签，再把棋谱、摘要和交易画成一页 SVG（FR-31）。
  function makeCertificate(evidence, levelName = '') {
    const svg = buildCertificateSvg(evidence, { theme, levelName });
    download(certificateFileName(evidence), svg, 'image/svg+xml');
    announce('对局证书已导出（SVG）');
  }
  async function exportCertificate() {
    try { makeCertificate(await client.exportEvidence(), state.mode === 'ai' ? LEVELS[state.aiLevel]?.name : ''); }
    catch (e) { setError(`证书生成失败：${e.message || e}`); }
  }
  // 从对局记录导出：刷新后客户端已回到空闲态，但每局证据仍保存在本地，证书不依赖当前对局状态。
  function exportCertificateById(item) {
    try {
      const evidence = client.repository.readEvidence(item.id);
      if (!evidence) throw new Error('本地没有保存这局的证据，无法生成证书');
      makeCertificate(evidence, evidence.opponent?.levelName || '');
    } catch (e) { setError(`证书生成失败：${e.message || e}`); }
  }
  async function importEvidenceFile(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setImportResult(null);
    await act('读取并验证证据 JSON', async () => {
      let evidence;
      try { evidence = JSON.parse(await file.text()); }
      catch { throw new Error('证据文件不是有效的 JSON，请选择导出的证据文件。'); }
      const verified = await client.importEvidence(evidence);
      if (!verified?.valid) throw new Error('证据未通过验证，未确认恢复结果。');
      setImportResult({ ...verified, fileName: file.name, receiptCount: verified.transactions.length });
      setForce(false);
      announce('证据已验证并恢复，可查看棋盘与链上状态');
    });
  }
  // 提示是纯只读分析：不签名、不发交易。放进 setTimeout 让“思考中”先渲染出来。
  function requestHint() {
    setLocalBusy('正在分析局面');
    setTimeout(() => {
      try { setHintList(suggestMoves(moves, 3, { level: 'master', timeBudgetMs: 700 })); }
      catch (e) { setError(e.message || String(e)); }
      finally { setLocalBusy(''); }
    }, 30);
  }
  const canHint = !busy && !state.terminal && state.status === 'active' && isMyTurn && reviewIndex == null && !state.pending && (state.mode === 'ai' || state.connected);
  const turnText = state.aiThinking ? 'AI 正在思考…' : busy ? (localBusy || state.demoProgress || '正在同步对局…') : reviewIndex != null ? `复盘中 · 第 ${reviewIndex} 手` : result || (state.pending ? '等待双方签名确认' : state.status === 'active' ? (isMyTurn ? '轮到你落子' : `等待${playerName(state.nextPlayer)}落子`) : state.status === 'invited' && state.peerConnected ? '双方已到齐，等待链上开通' : STATUS[state.status] || '等待状态同步');
  const moveVersion = `${state.channelId}:${moves.join(',')}:${state.status}:${force}:${state.role}:${state.nextPlayer}`;
  const submitMove = (p) => {
    if (!canMove) { setError('局面或连接已变化，请重新核对后落子。'); return; }
    return act(force && state.status === 'dispute' ? '提交链上落子' : '发送落子提案', () => force && state.status === 'dispute' ? client.forceMove(p) : client.move(p));
  };
  const onBoardMove = (p) => {
    if (!canMove) return;
    if (confirmMove || (force && state.status === 'dispute')) setDraftMove({ position: p, version: moveVersion });
    else submitMove(p);
  };
  const aiBusyStart = busy || !state.ready || ['active', 'dispute', 'invited'].includes(state.status);
  const c = { state, client, busy, act, moves, txs, history, hasRoom, finished, stake, setStake, room, setRoom, inviteCode, role, result, isParticipant, copy, savings, countdown, force, setForce, exportEvidence, importEvidenceFile, importResult, exportCertificateById };
  const [headline, subline] = HEADINGS[tab];
  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#" onClick={(e) => { e.preventDefault(); setTab('lobby'); }} aria-label="弈信 对局大厅"><span className="brand-symbol"><i/><i/></span><span><strong>弈<span>·</span>信</strong><small>GOMOKU CHANNEL LAB</small></span></a>
      <div className="header-right">
        <span className={`network-pill ${state.ready ? 'online' : ''}`}><i/>{external ? (state.ready ? '外部钱包已连接' : '等待外部钱包') : (state.ready ? '本地链已连接' : '本地链未连接')}<span className="network-id"> · {state.chainId || 31337}</span></span>
        <div className="wallet"><span className="wallet-icon"><Icon name="wallet"/></span><div><strong>{state.address ? short(state.address) : external ? '浏览器钱包' : '本地测试钱包'}</strong><small>{state.ready ? `${state.points ?? 0} 演示积分` : external ? '连接钱包并注册' : '等待本地服务'}</small></div>{state.address && <CopyButton value={state.address} label="复制钱包地址" compact onCopy={copy}/>}</div>
        <button type="button" className="tool-button" aria-pressed={sound} aria-label={sound ? '关闭音效' : '开启音效'} title={sound ? '关闭音效' : '开启音效'} onClick={() => setSound(!sound)}><Icon name={sound ? 'volume' : 'mute'} size={18}/></button>
        <button type="button" className="tool-button" aria-label={theme === 'dark' ? '切换为日间主题' : '切换为夜间主题'} title={theme === 'dark' ? '日间主题' : '夜间主题'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18}/></button>
      </div>
    </header>
    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-label">开始探索</div>
        <nav aria-label="主导航">{NAV.map((item) => <button key={item.id} className={`nav-item ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}><Icon name={item.icon}/><span>{item.text}</span>{tab === item.id && <span className="nav-dot"/>}</button>)}</nav>
        <div className="sidebar-note"><span className="note-icon"><Icon name="shield" size={24}/></span><strong>每一步，皆有凭据。</strong><p>链下对弈 · 双方签名<br/>链上结算 · 可验证结果</p><span className="local-tag">{external ? '独立节点 · 外部钱包' : '本地单节点教学链'}</span></div>
        <div className="sidebar-bottom"><span className="tiny-dot"/> {external ? 'EXTERNAL RPC / 用户钱包' : 'LOCAL EVM / 开源实验'}</div>
      </aside>
      <main className="main">
        <div className="page-heading"><div><div className="eyebrow">PLAY WITH TRUST. SETTLE ON CHAIN.</div><h1>{headline}</h1><p>{subline}</p></div><span className="environment"><Icon name="bolt" size={15}/> {external ? `${state.networkName || '外部节点'} · 无资产价值积分` : '本地单节点 EVM · 演示积分'}</span></div>
        {error && <div className="error-banner" role="alert"><Icon name="info" size={19}/><div><strong>操作未完成</strong><p>{error}</p></div><button aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div>}
        {external && !state.ready && <section className="panel">
          <h2>连接你的钱包</h2>
          <p>请在钱包切换至链 {state.chainId}。私钥由钱包保管；连接不会自动发交易。首次注册会发起合约交易，需钱包确认并支付该网络的 gas。</p>
          <Button disabled={busy} onClick={() => act('连接外部钱包', () => client.connectExternalWallet())}>连接浏览器钱包</Button>
          {state.walletConnected && <Button disabled={busy} onClick={() => act('注册演示积分', () => client.registerExternalWallet())}>确认注册演示积分</Button>}
        </section>}
        {tab === 'lobby' && <div className="play-layout">
          <div className="game-panel">
            <section className="board-card">
              <div className="board-heading"><div><span className="section-kicker">THE BOARD</span><h2>五子棋 <span>15 × 15 · 自由规则</span></h2></div><span className={`status-chip ${state.status === 'active' || state.terminal ? 'green' : ''}`}><i/>{STATUS[state.status] || state.status}</span></div>
              <div className={`turn-banner ${state.terminal && reviewIndex == null ? 'is-result' : ''}`} role="status"><span className={`turn-stone ${state.nextPlayer === 2 ? 'white' : ''}`}/><strong>{turnText}</strong><span>{moves.length ? `第 ${moves.length} 手已确认` : '黑棋先行 · 连五获胜'}</span>{(busy || state.aiThinking) && <span className="spinner"/>}</div>
              <Board moves={shownMoves} pending={state.pending} force={force && state.status === 'dispute'} canMove={canMove} busy={busy} onMove={onBoardMove} winnerShown={Boolean(state.winner && state.terminal && reviewIndex == null)} hints={hintCells} threats={threatCells} showNumbers={showNumbers} reviewing={reviewIndex != null}/>
              <label className="switch-row move-confirm-toggle"><span>落子前确认坐标</span><input type="checkbox" checked={confirmMove} onChange={e => setConfirmMove(e.target.checked)}/></label>
              <div className="board-footer"><span><i className="legend-dot"/> 最近一步</span><span><Icon name="shield" size={14}/>{state.mode === 'demo' ? '自动演示 · 双本地钱包' : state.mode === 'ai' ? `人机对弈 · ${LEVELS[state.aiLevel]?.name || 'AI'}` : '双方签名后确认棋子'}</span><span>{moves.length} / 225 手</span></div>
              {!hasRoom && <div className="board-empty-note"><span>棋盘已就绪</span> {external ? '请连接外部钱包，并邀请另一位玩家创建双人对局。' : '在右侧创建双人对局、与 AI 对弈，或运行完整自动演示。'}</div>}
              {state.mode === 'demo' && <div className="demo-progress" role="status"><Icon name="play" size={15}/><span>{state.demoProgress || '此局由两个本地演示钱包自动执棋，交易由本地测试链实际执行。'}</span></div>}
            </section>
            {moves.length > 0 && <ReviewPanel moves={moves} reviewIndex={reviewIndex} onReview={setReviewIndex} showNumbers={showNumbers} onShowNumbers={setShowNumbers} showThreats={showThreats} onShowThreats={setShowThreats} canHint={canHint} onHint={requestHint} hintList={hintList}/>}
          </div>
          <aside className="game-panel">
            <MatchPanel c={c}/>
            <RecoveryPanel c={c}/>
            {!external && (!hasRoom || finished) && <AiPanel level={aiLevel} onLevel={setAiLevel} side={aiSide} onSide={setAiSide} stake={stake} disabled={aiBusyStart || !Number.isInteger(Number(stake)) || Number(stake) <= 0} onStart={() => act('正在准备人机对局', () => client.startAiGame(aiLevel, aiSide, Number(stake)))}/>}
            {!external && <section className="demo-card">
              <div className="demo-heading"><span className="demo-icon"><Icon name="play" size={19}/></span><div><h3>先看一局，理解全部</h3><p>双本地钱包 · 9 手黑胜 · 真实结算</p></div></div>
              <Button kind="dark" icon="play" disabled={!state.ready || busy || ['active', 'dispute', 'invited'].includes(state.status)} onClick={() => act('完整自动演示运行中', () => client.runDemo())}>运行完整自动演示</Button>
              <p>{['active', 'dispute'].includes(state.status) && state.mode !== 'demo' ? '请先完成当前对局，再开启独立演示。' : '独立演示局，由脚本执黑与执白。'}<br/>实际发送本地链交易，可在实验室核验。</p>
            </section>}
            {state.status === 'settled' && moves.length > 0 && <section className="demo-card"><div className="demo-heading"><span className="demo-icon"><Icon name="stamp" size={19}/></span><div><h3>对局证书</h3><p>棋谱 · 摘要 · 交易，一页留念</p></div></div><Button icon="download" disabled={busy} onClick={exportCertificate}>导出对局证书（SVG）</Button></section>}
            <ExperimentPanel c={c}/>
          </aside>
        </div>}
        {tab === 'lab' && <LabPage c={c}/>}
        {tab === 'history' && <HistoryPage c={c}/>}
        {tab === 'about' && <AboutPage external={external} onBack={() => setTab('lobby')}/>}
        <footer className="page-footer"><span>弈·信 <span className="footer-dot">/</span> 每一步信任，都有迹可循。</span><span>{external ? '外部钱包确认 · 独立节点核验' : '本地运行 · 证据可导出 · 结果可验证'}</span></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><Icon name="check" size={18}/>{toast}</div>}
    {draftMove && <MoveConfirmation position={draftMove.position} force={force && state.status === 'dispute'} onCancel={() => setDraftMove(null)} onConfirm={() => {
      const draft = draftMove; setDraftMove(null);
      if (draft.version !== moveVersion) { setError('局面已变化，请重新选择落点。'); return; }
      submitMove(draft.position);
    }}/>}
  </div>;
}
