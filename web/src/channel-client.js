import { Wallet, JsonRpcProvider, Contract, AbiCoder, keccak256, randomBytes, TypedDataEncoder, verifyTypedData } from 'ethers';
import { STATE_TYPES, BLACK_WIN, evaluate, movesHex, fromHex, isPrefix, requireExtension, metrics, relayAuthText } from '../../shared/gomoku.mjs';
import { verifyEvidence } from '../../shared/evidence.mjs';
import { chooseMove, LEVELS } from '../../shared/ai.mjs';
const STATUS = ['idle', 'invited', 'active', 'dispute', 'settled', 'cancelled'];
const STORE = 'gomoku-channel-v1';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();
function readableError(e) { return e.reason || e.shortMessage || e.message || String(e); }
export class ChannelClient {
  constructor() {
    this.listeners = new Set(); this._room = null; this._checkpoint = { moves: [], sigBlack: '', sigWhite: '' }; this._handling = Promise.resolve();
    this.state = { ready: false, busy: false, error: '', mode: 'player', address: '', points: 0, chainId: 31337, contractAddress: '', channelId: '', inviteUrl: '', role: 0, black: '', white: '', stake: 10, status: 'idle', moves: [], pending: null, winner: 0, terminal: false, reason: '', nextPlayer: 1, deadline: 0, challengePeriod: 60, now: Math.floor(Date.now() / 1000), connected: false, peerConnected: false, autoAck: true, signatures: { black: '', white: '' }, digest: '', transactions: [], events: [], history: [], initialization: [], demoProgress: '', aiLevel: '', aiThinking: false, networkName: 'Gomoku Local EVM', metrics: metrics([], []) };
    try { this.state.history = JSON.parse(localStorage.getItem(`${STORE}:history`) || '[]'); } catch {}
  }
  subscribe(fn) { this.listeners.add(fn); fn(this._snapshot()); return () => this.listeners.delete(fn); }
  _snapshot() { return structuredClone(this.state); }
  _emit(patch = {}) { Object.assign(this.state, patch); this.state.metrics = metrics(this.state.moves, this.state.transactions); for (const fn of this.listeners) fn(this._snapshot()); }
  _log(text, kind = 'info') { this.state.events = [...this.state.events.slice(-79), { time: new Date().toISOString(), text, kind }]; this._emit(); }
  async _api(url, body) {
    const res = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json(); if (!res.ok) throw Error(data.error || '服务请求失败'); return data;
  }
  async init() {
    this.config = await this._api('/api/config');
    this.provider = new JsonRpcProvider(`${location.origin}/rpc`, undefined, { cacheTimeout: -1 }); this.provider.pollingInterval = 150;
    let key = localStorage.getItem(`${STORE}:local-test-key`);
    if (!key) { key = Wallet.createRandom().privateKey; localStorage.setItem(`${STORE}:local-test-key`, key); }
    this.wallet = new Wallet(key, this.provider); this.contract = new Contract(this.config.address, this.config.abi, this.wallet);
    this.domain = { name: 'GomokuChannel', version: '1', chainId: this.config.chainId, verifyingContract: this.config.address };
    this._emit({ address: this.wallet.address, chainId: this.config.chainId, contractAddress: this.config.address, challengePeriod: this.config.challengePeriod });
    await this._prepareWallet(this.wallet);
    this._emit({ ready: true, points: Number(await this.contract.points(this.wallet.address)) });
    this._log('本地测试钱包已就绪，积分由链上合约记账');
    this._timer = setInterval(() => { this._emit({ now: Math.floor(Date.now() / 1000) }); if (!this._refreshing && !this.state.busy) this.refresh().catch(e => this._log(readableError(e), 'warning')); }, 2000);
    const saved = localStorage.getItem(`${STORE}:active-room:${this.config.address}`);
    if (saved) { try { await this.joinRoom(saved); } catch (e) {
      this._log(`中继恢复失败：${readableError(e)}`, 'warning');
      const activeId = localStorage.getItem(`${STORE}:active-channel:${this.config.address}`);
      const raw = activeId && localStorage.getItem(`${STORE}:evidence:${activeId}`);
      if (raw) { try { await this.importEvidence(JSON.parse(raw)); this._log('已从本地证据恢复，可直接进行链上争议', 'success'); } catch (restoreError) { this._log(readableError(restoreError), 'warning'); } }
    } }
    else await this._resumeAi();
  }
  async _prepareWallet(wallet) {
    await this._api('/api/faucet', { address: wallet.address });
    const c = this.contract.connect(wallet);
    if (!await c.registered(wallet.address)) {
      const tx = await c.register(); const receipt = await tx.wait();
      this.state.initialization.push({ label: '新钱包注册（每地址一次）', hash: receipt.hash, gasUsed: receipt.gasUsed.toString() });
      this._log('完成一次链上注册，领取1000演示积分（不计入每局交易）');
    }
  }
  async _busy(fn) {
    if (this.state.busy) throw Error('上一项操作正在执行，请稍候');
    this._emit({ busy: true, error: '' });
    try { return await fn(); } catch (e) { this._emit({ error: readableError(e) }); this._log(readableError(e), 'warning'); throw e; }
    finally { this._emit({ busy: false }); }
  }
  _resetGame() {
    this._checkpoint = { moves: [], sigBlack: '', sigWhite: '' }; this._room = null; this._demoId = null;
    this._emit({ mode: 'player', channelId: '', inviteUrl: '', role: 0, black: '', white: '', stake: 10, status: 'idle', moves: [], pending: null, winner: 0, terminal: false, reason: '', nextPlayer: 1, deadline: 0, signatures: { black: '', white: '' }, digest: '', transactions: [], events: [], demoProgress: '', aiLevel: '', aiThinking: false, peerConnected: false });
    this._ai = null;
  }
  async createRoom(stake = 10) {
    return this._busy(async () => {
      if (['active', 'dispute', 'invited'].includes(this.state.status)) throw Error('请先完成当前对局再创建新局');
      this._closeSocket(); this._resetGame();
      const room = await this._api('/api/rooms', { address: this.wallet.address, stake });
      await this._connect(room.roomId); this._log('房间已创建，请将邀请链接发送给另一位棋手');
    });
  }
  async joinRoom(input) {
    return this._busy(async () => {
      let id = input.trim(); if (id.includes('?')) id = new URL(id).searchParams.get('room') || id;
      const room = await this._api(`/api/rooms/${encodeURIComponent(id)}`);
      this._closeSocket(); this._resetGame(); await this._connect(room.roomId);
    });
  }
  _connect(roomId) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`); this.ws = ws;
      let authenticated = false;
      const timer = setTimeout(() => { if (!authenticated) { ws.close(); reject(Error('房间连接超时')); } }, 12000);
      ws.onmessage = event => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'hello') {
          this.wallet.signMessage(relayAuthText(msg.nonce, roomId, this.config.chainId, this.config.address)).then(signature => ws.send(JSON.stringify({ type: 'auth', roomId, address: this.wallet.address, signature }))).catch(reject);
        } else if (msg.type === 'room') {
          if (!authenticated) { authenticated = true; clearTimeout(timer); this._emit({ connected: true }); resolve(); }
          this._handling = this._handling.then(() => this._onRoom(msg)).catch(e => { this._emit({ error: readableError(e) }); this._log(readableError(e), 'warning'); });
        } else if (msg.type === 'error') {
          if (!authenticated) { clearTimeout(timer); reject(Error(msg.message)); }
          this._emit({ error: msg.message }); this._log(msg.message, 'warning');
        }
      };
      ws.onerror = () => { if (!authenticated) { clearTimeout(timer); reject(Error('无法连接房间中继')); } };
      ws.onclose = () => { clearTimeout(timer); if (this.ws === ws) this._emit({ connected: false, peerConnected: false }); };
    });
  }
  _send(msg) { if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw Error('中继已断开；已有签名仍可用于链上争议'); this.ws.send(JSON.stringify(msg)); }
  _closeSocket() { if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; } this._emit({ connected: false, peerConnected: false }); }
  _verifyCheckpoint(checkpoint, room) {
    evaluate(checkpoint.moves);
    if (!checkpoint.moves.length) return;
    const value = { channelId: room.channelId, movesHash: keccak256(movesHex(checkpoint.moves)) };
    if (!same(verifyTypedData(this.domain, STATE_TYPES, value, checkpoint.sigBlack), room.black) || !same(verifyTypedData(this.domain, STATE_TYPES, value, checkpoint.sigWhite), room.white)) throw Error('中继提供的双签快照验证失败');
  }
  async _onRoom({ room, peers }) {
    const role = same(this.wallet.address, room.black) ? 1 : 2;
    if (room.channelId) {
      const expectedId = keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'address', 'bytes32'], [room.black, room.white, room.salt]));
      if (expectedId !== room.channelId) throw Error('房间身份与通道编号不匹配');
    }
    this._verifyCheckpoint(room.checkpoint, room);
    if (!isPrefix(this._checkpoint.moves, room.checkpoint.moves)) throw Error('拒绝中继回退或分叉已确认快照');
    this._room = room; this._checkpoint = room.checkpoint;
    localStorage.setItem(`${STORE}:active-room:${this.config.address}`, room.roomId);
    const url = new URL(location.href); url.search = ''; url.searchParams.set('room', room.roomId);
    const merged = [...this.state.transactions]; for (const tx of room.transactions) if (!merged.some(t => t.hash === tx.hash)) merged.push(tx);
    this._emit({ role, black: room.black, white: room.white, stake: room.stake, channelId: room.channelId || room.roomId, inviteUrl: url.toString(), peerConnected: peers.some(p => !same(p, this.wallet.address)), transactions: merged });
    this._applyCheckpoint();
    if (room.channelId) await this._lifecycle();
    else this._emit({ status: 'invited' });
    if (room.proposal) {
      requireExtension(this._checkpoint.moves, room.proposal.moves);
      const expected = this._checkpoint.moves.length % 2 === 0 ? room.black : room.white;
      if (!same(expected, room.proposal.by)) throw Error('提案棋手轮次不符');
      const actual = verifyTypedData(this.domain, STATE_TYPES, { channelId: room.channelId, movesHash: keccak256(movesHex(room.proposal.moves)) }, room.proposal.signature);
      if (!same(actual, expected)) throw Error('落子提案签名不合法');
      this._emit({ pending: { position: room.proposal.moves.at(-1), by: same(expected, room.black) ? 1 : 2, moves: room.proposal.moves } });
      if (this.state.autoAck && !same(expected, this.wallet.address) && this.state.status === 'active') await this.acknowledge();
    } else this._emit({ pending: null });
  }
  _applyCheckpoint() {
    const cp = this._checkpoint, result = evaluate(cp.moves);
    this._emit({ moves: [...cp.moves], winner: result.winner, terminal: result.terminal, nextPlayer: result.nextPlayer, signatures: { black: cp.sigBlack, white: cp.sigWhite }, digest: this._room?.channelId || this._demoId ? TypedDataEncoder.hash(this.domain, STATE_TYPES, { channelId: this._room?.channelId || this._demoId, movesHash: keccak256(movesHex(cp.moves)) }) : '' });
    if (this.state.channelId) {
      localStorage.setItem(`${STORE}:evidence:${this.state.channelId}`, JSON.stringify(this.exportEvidence()));
      localStorage.setItem(`${STORE}:active-channel:${this.config.address}`, this.state.channelId);
    }
  }
  async _lifecycle() {
    if (this._lifecycleBusy || !this._room?.channelId) return;
    this._lifecycleBusy = true;
    try {
      const r = this._room, c = await this.contract.getChannel(r.channelId);
      if (Number(c.status) === 0 && this.state.role === 1) {
        this._log('另一位棋手已加入，正在链上锁定黑方积分');
        await this._transaction(this.contract.openChannel(r.white, r.stake, r.salt), '锁定黑方积分');
      } else if (Number(c.status) === 1 && this.state.role === 2) {
        this._log('黑方已开通通道，正在链上锁定白方积分');
        await this._transaction(this.contract.joinChannel(r.channelId), '锁定白方积分');
      }
      await this.refresh();
    } finally { this._lifecycleBusy = false; }
  }
  async refresh() {
    if (!this.contract || this._refreshing) return;
    this._refreshing = true;
    try {
      const id = this._room?.channelId || this._demoId;
      const points = Number(await this.contract.points(this.wallet.address));
      if (!id) { this._emit({ points }); return; }
      const c = await this.contract.getChannel(id), status = STATUS[Number(c.status)];
      if (Number(c.status) === 0) { this._emit({ points, status: 'invited' }); return; }
      if (this._room && (!same(c.black, this._room.black) || !same(c.white, this._room.white) || Number(c.stake) !== this._room.stake)) throw Error('链上参与者或积分与房间约定不符');
      if (Number(c.status) >= 3) {
        const moves = fromHex(c.moves), result = evaluate(moves);
        this._emit({ moves, winner: Number(c.winner), terminal: status === 'settled' || result.terminal, nextPlayer: result.nextPlayer, pending: null });
      }
      this._emit({ points, status, black: c.black, white: c.white, deadline: Number(c.deadline), reason: ['', '五子连珠', '满盘和棋', '超时判负'][Number(c.reason)] || '' });
      if (status === 'settled') this._saveHistory();
      if (this._room && (Number(c.status) === 0 && this.state.role === 1 || Number(c.status) === 1 && this.state.role === 2) && !this._lifecycleBusy) queueMicrotask(() => this._lifecycle().catch(e => this._log(readableError(e), 'warning')));
    } finally { this._refreshing = false; }
  }
  async _transaction(transactionPromise, label) {
    const tx = await transactionPromise; this._log(`${label}：交易已提交，等待区块确认`);
    const receipt = await tx.wait(); if (receipt.status !== 1) throw Error('链上交易执行失败');
    const block = await this.provider.getBlock(receipt.blockNumber);
    const record = { label, hash: receipt.hash, gasUsed: receipt.gasUsed.toString(), blockNumber: receipt.blockNumber, timestamp: block.timestamp };
    if (!this.state.transactions.some(t => t.hash === record.hash)) this.state.transactions.push(record);
    this._log(`${label}已确认 · gas ${record.gasUsed}`, 'success');
    if (this._room && this.ws?.readyState === WebSocket.OPEN) this._send({ type: 'tx', hash: receipt.hash });
    return receipt;
  }
  async move(position) {
    if (this.state.mode === 'ai') return this._aiHumanMove(position);
    return this._busy(async () => {
      if (this.state.status !== 'active' || this.state.terminal) throw Error('当前对局不能进行链下落子');
      if (this.state.role !== this.state.nextPlayer) throw Error('请等待对方落子');
      if (this.state.pending) throw Error('请等待双方确认上一手');
      const next = [...this._checkpoint.moves, position]; requireExtension(this._checkpoint.moves, next);
      const signature = await this.wallet.signTypedData(this.domain, STATE_TYPES, { channelId: this._room.channelId, movesHash: keccak256(movesHex(next)) });
      this._send({ type: 'propose', moves: next, signature });
      this._log(`第${next.length}手已签名，等待对方确认`);
    });
  }
  async acknowledge() {
    const proposal = this._room?.proposal;
    if (!proposal || same(proposal.by, this.wallet.address)) throw Error('没有等待确认的对方提案');
    if (this._acking === movesHex(proposal.moves)) return;
    requireExtension(this._checkpoint.moves, proposal.moves);
    const key = movesHex(proposal.moves); this._acking = key;
    try {
      const signature = await this.wallet.signTypedData(this.domain, STATE_TYPES, { channelId: this._room.channelId, movesHash: keccak256(key) });
      this._send({ type: 'ack', signature }); this._log(`第${proposal.moves.length}手双方确认，全程未发送链上交易`, 'success');
    } finally { this._acking = null; }
  }
  setAutoAck(value) { this._emit({ autoAck: Boolean(value) }); if (value && this.state.pending && this.state.pending.by !== this.state.role) this.acknowledge().catch(e => this._log(readableError(e), 'warning')); }
  async settle() {
    return this._busy(async () => {
      const cp = this._checkpoint; if (!evaluate(cp.moves).terminal) throw Error('尚未终局，请继续对局或发起争议');
      await this._transaction(this.contract.settle(this.state.channelId, movesHex(cp.moves), cp.sigBlack, cp.sigWhite), '结算积分');
      await this.refresh(); this._log('链上已核验完整合法棋谱与双方签名，积分结算完成', 'success');
    });
  }
  async challenge() {
    return this._busy(async () => {
      const cp = this._checkpoint;
      await this._transaction(this.contract.challenge(this.state.channelId, movesHex(cp.moves), cp.sigBlack || '0x', cp.sigWhite || '0x'), '提交争议快照');
      await this.refresh(); this._log('已进入链上争议。下一位棋手须在截止前落子，每次有效更新重置响应期限', 'warning');
    });
  }
  async forceMove(position) { return this._busy(async () => { await this._transaction(this.contract.forceMove(this.state.channelId, position), '链上强制落子'); await this.refresh(); }); }
  async claimTimeout() { return this._busy(async () => { await this._transaction(this.contract.claimTimeout(this.state.channelId), '超时结算'); await this.refresh(); }); }
  async cancelUnjoined() { return this._busy(async () => { await this._transaction(this.contract.cancelUnjoined(this.state.channelId), '取消超时邀请'); await this.refresh(); }); }
  _saveHistory() {
    const record = { id: this.state.channelId, winner: this.state.winner, movesCount: this.state.moves.length, transactions: this.state.transactions.length, settledAt: new Date().toISOString(), mode: this.state.mode, gas: this.state.metrics.totalGas };
    const old = this.state.history.findIndex(h => h.id === record.id);
    if (old >= 0) { record.settledAt = this.state.history[old].settledAt; this.state.history[old] = record; }
    else this.state.history.unshift(record);
    if (this.state.mode === 'ai') { record.aiLevel = this.state.aiLevel; localStorage.removeItem(this._aiSessionKey()); }
    localStorage.setItem(`${STORE}:history`, JSON.stringify(this.state.history));
    localStorage.setItem(`${STORE}:evidence:${record.id}`, JSON.stringify(this.exportEvidence())); this._emit();
  }
  exportEvidence() {
    return { format: 'gomoku-channel-evidence/v1', exportedAt: new Date().toISOString(), localTeachingOnly: true,
      domain: this.domain, channelId: this.state.channelId, participants: { black: this.state.black, white: this.state.white }, stake: this.state.stake,
      // 人机局标注对手类型（说明性字段，不参与签名核验）。
      opponent: this.state.mode === 'ai' ? { type: 'local-ai', level: this.state.aiLevel, levelName: LEVELS[this.state.aiLevel]?.name || '' } : undefined,
      checkpoint: structuredClone(this._checkpoint), onchain: { status: this.state.status, moves: this.state.moves, winner: this.state.winner, reason: this.state.reason, deadline: this.state.deadline },
      transactions: structuredClone(this.state.transactions), initialization: structuredClone(this.state.initialization), metrics: structuredClone(this.state.metrics),
      trustBoundary: '积分无现实价值；独立保管签名快照，并在挑战期内监控链；中继不可代签；本地开发RPC不适合公网。' };
  }
  async importEvidence(evidence) {
    return this._busy(async () => {
      const verified = verifyEvidence(evidence, { chainId: this.config.chainId, verifyingContract: this.config.address });
      const c = await this.contract.getChannel(evidence.channelId);
      if (Number(c.status) < 2 || !same(c.black, verified.black) || !same(c.white, verified.white) || Number(c.stake) !== evidence.stake) throw Error('链上通道与证据参与者或积分不匹配');
      const transactions = [];
      for (const tx of evidence.transactions || []) {
        const receipt = await this.provider.getTransactionReceipt(tx.hash);
        if (!receipt || receipt.status !== 1 || !same(receipt.to, this.config.address)) throw Error('证据中含无法核验的交易');
        const belongs = receipt.logs.some(log => { try { return same(log.address, this.config.address) && this.contract.interface.parseLog(log)?.args.id === evidence.channelId; } catch { return false; } });
        if (!belongs) throw Error('证据交易不属于本局');
        transactions.push({ ...tx, gasUsed: receipt.gasUsed.toString(), blockNumber: receipt.blockNumber });
      }
      this._closeSocket(); this._resetGame(); this._demoId = evidence.channelId;
      this._checkpoint = structuredClone(evidence.checkpoint);
      const role = same(this.wallet.address, verified.black) ? 1 : same(this.wallet.address, verified.white) ? 2 : 0;
      this._emit({ mode: 'player', channelId: evidence.channelId, role, black: verified.black, white: verified.white, stake: evidence.stake, transactions, status: STATUS[Number(c.status)] });
      this._applyCheckpoint(); await this.refresh();
      this._log(`证据双签和${transactions.length}笔交易已核验；当前为独立证据恢复模式`, 'success');
      return verified;
    });
  }
  // ---------- 人机对弈：AI 是第二个本地测试钱包，协议与真人局完全相同 ----------
  _aiSessionKey() { return `${STORE}:ai-session:${this.config.address}`; }
  // 人和 AI 各对“完整有序棋谱”做一次 EIP-712 签名，合成一个双签快照。
  async _signBoth(moves) {
    const value = { channelId: this._demoId, movesHash: keccak256(movesHex(moves)) };
    const [mine, theirs] = await Promise.all([this.wallet.signTypedData(this.domain, STATE_TYPES, value), this._ai.wallet.signTypedData(this.domain, STATE_TYPES, value)]);
    const humanIsBlack = this._ai.humanRole === 1;
    return { moves, sigBlack: humanIsBlack ? mine : theirs, sigWhite: humanIsBlack ? theirs : mine };
  }
  async startAiGame(level = 'adept', humanRole = 1, stake = 10) {
    return this._busy(async () => {
      if (!LEVELS[level]) throw Error('未知的 AI 难度');
      if (!Number.isInteger(stake) || stake < 1) throw Error('对局积分须为正整数');
      if (['active', 'dispute', 'invited'].includes(this.state.status)) throw Error('请先完成当前对局再开始人机对弈');
      this._closeSocket(); this._resetGame();
      const ai = Wallet.createRandom().connect(this.provider);
      this._emit({ mode: 'ai', aiLevel: level, demoProgress: '正在准备 AI 对手的本地钱包' });
      await this._prepareWallet(ai);
      const salt = '0x' + Array.from(randomBytes(32), b => b.toString(16).padStart(2, '0')).join('');
      const black = humanRole === 1 ? this.wallet : ai, white = humanRole === 1 ? ai : this.wallet;
      const id = keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'address', 'bytes32'], [black.address, white.address, salt]));
      this._demoId = id; this._ai = { wallet: ai, level, humanRole };
      this._emit({ channelId: id, role: humanRole, black: black.address, white: white.address, stake, status: 'invited', demoProgress: '双方锁定积分' });
      await this._transaction(this.contract.connect(black).openChannel(white.address, stake, salt), '锁定黑方积分');
      await this._transaction(this.contract.connect(white).joinChannel(id), '锁定白方积分');
      this._emit({ status: 'active', connected: false, peerConnected: false, demoProgress: '' });
      localStorage.setItem(this._aiSessionKey(), JSON.stringify({ key: ai.privateKey, channelId: id, level, humanRole }));
      this._applyCheckpoint(); await this.refresh();
      this._log(`人机对局开始：对手「${LEVELS[level].name}」，每手仍由双方 EIP-712 签名，链上只有开通与结算`, 'success');
      if (humanRole === 2) await this._aiReply();
    });
  }
  async _aiHumanMove(position) {
    return this._busy(async () => {
      if (this.state.status !== 'active' || this.state.terminal) throw Error('当前对局不能落子');
      if (this.state.role !== this.state.nextPlayer) throw Error('请等待 AI 落子');
      const next = [...this._checkpoint.moves, position]; requireExtension(this._checkpoint.moves, next);
      this._checkpoint = await this._signBoth(next); this._applyCheckpoint();
      this._log(`第${next.length}手已由你和 AI 双方签名确认，全程未发送链上交易`, 'success');
      if (!this.state.terminal) await this._aiReply();
    });
  }
  async _aiReply() {
    this._emit({ aiThinking: true });
    try {
      await pause(380); // 给界面一次重绘机会，并让节奏更像“对手在思考”
      const level = this._ai.level, moves = this._checkpoint.moves;
      const position = chooseMove(moves, { level, timeBudgetMs: LEVELS[level].timeBudgetMs });
      const next = [...moves, position]; requireExtension(moves, next);
      this._checkpoint = await this._signBoth(next); this._applyCheckpoint();
      this._log(`AI 落子并与你双签：第${next.length}手`);
    } finally { this._emit({ aiThinking: false }); }
  }
  // 刷新页面后恢复未完成的人机局：私钥只存于本地浏览器，棋谱与双签重新核验后才接受。
  async _resumeAi() {
    const raw = localStorage.getItem(this._aiSessionKey()); if (!raw) return;
    try {
      const s = JSON.parse(raw), c = await this.contract.getChannel(s.channelId);
      if (Number(c.status) !== 2) { localStorage.removeItem(this._aiSessionKey()); return; }
      const evidence = JSON.parse(localStorage.getItem(`${STORE}:evidence:${s.channelId}`) || 'null');
      if (!evidence) throw Error('缺少本地证据');
      verifyEvidence(evidence, { chainId: this.config.chainId, verifyingContract: this.config.address });
      this._ai = { wallet: new Wallet(s.key, this.provider), level: s.level, humanRole: s.humanRole };
      this._demoId = s.channelId; this._checkpoint = structuredClone(evidence.checkpoint);
      this._emit({ mode: 'ai', aiLevel: s.level, channelId: s.channelId, role: s.humanRole, black: c.black, white: c.white, stake: Number(c.stake), status: 'active', transactions: evidence.transactions || [] });
      this._applyCheckpoint(); await this.refresh();
      this._log('已恢复未完成的人机对局（棋谱与双签取自本地证据并重新核验）', 'success');
      if (!this.state.terminal && this._checkpoint.moves.length % 2 + 1 !== s.humanRole) await this._aiReply();
    } catch (e) { localStorage.removeItem(this._aiSessionKey()); this._log(`人机对局恢复失败：${readableError(e)}`, 'warning'); }
  }
  async runDemo() {
    return this._busy(async () => {
      if (['active', 'dispute'].includes(this.state.status)) throw Error('请先完成当前对局');
      this._closeSocket(); this._resetGame(); this._emit({ mode: 'demo', demoProgress: '准备两位本地测试棋手' });
      const black = this.wallet, white = Wallet.createRandom().connect(this.provider); await this._prepareWallet(white);
      const salt = '0x' + Array.from(randomBytes(32), b => b.toString(16).padStart(2, '0')).join('');
      const id = keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'address', 'bytes32'], [black.address, white.address, salt]));
      this._demoId = id;
      this._emit({ channelId: id, role: 1, black: black.address, white: white.address, stake: 10, status: 'invited', demoProgress: '1 / 3 · 双方锁定积分' });
      await this._transaction(this.contract.openChannel(white.address, 10, salt), '锁定黑方积分');
      await this._transaction(this.contract.connect(white).joinChannel(id), '锁定白方积分');
      this._emit({ status: 'active', connected: false, peerConnected: false });
      for (let i = 0; i < BLACK_WIN.length; i++) {
        const moves = BLACK_WIN.slice(0, i + 1), value = { channelId: id, movesHash: keccak256(movesHex(moves)) };
        const sigBlack = await black.signTypedData(this.domain, STATE_TYPES, value), sigWhite = await white.signTypedData(this.domain, STATE_TYPES, value);
        this._checkpoint = { moves, sigBlack, sigWhite }; this._applyCheckpoint();
        this._emit({ demoProgress: `2 / 3 · 第 ${i + 1} 手已双签 · 链上交易仍为2笔` });
        await pause(230);
      }
      this._emit({ demoProgress: '3 / 3 · 提交合法终局棋谱，链上结算' });
      const cp = this._checkpoint;
      await this._transaction(this.contract.settle(id, movesHex(cp.moves), cp.sigBlack, cp.sigWhite), '结算积分');
      await this.refresh(); this._emit({ demoProgress: '演示完成 · 9手双签落子，3笔对局交易' });
      this._log('自动演示由同一程序控制两个本地钱包，不计作真人反馈', 'success');
    });
  }
  disconnect() { this._closeSocket(); this._log('已断开中继，仍保留本地签名快照，可发起链上争议', 'warning'); }
  destroy() { clearInterval(this._timer); this._closeSocket(); this.provider?.destroy(); this.listeners.clear(); }
}
