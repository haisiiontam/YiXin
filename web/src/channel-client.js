import { Wallet, BrowserProvider, JsonRpcProvider, Contract, AbiCoder, keccak256, randomBytes, TypedDataEncoder, verifyTypedData } from 'ethers';
import { STATE_TYPES, BLACK_WIN, evaluate, movesHex, fromHex, isPrefix, requireExtension, metrics, relayAuthText } from '../../shared/gomoku.mjs';
import { verifyEvidence } from '../../shared/evidence.mjs';
import { verifyEvidenceOnchain } from '../../shared/evidence-chain.mjs';
import { chooseMove, LEVELS } from '../../shared/ai.mjs';
import { GameRepository } from './game-repository.js';
const STATUS = ['idle', 'invited', 'active', 'dispute', 'settled', 'cancelled'];
const STORE = 'gomoku-channel-v1';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();
function readableError(e) { return e.reason || e.shortMessage || e.message || String(e); }
export class ChannelClient {
  constructor({ repository = new GameRepository() } = {}) {
    this.repository = repository;
    this.listeners = new Set(); this._room = null; this._checkpoint = { moves: [], sigBlack: '', sigWhite: '' }; this._handling = Promise.resolve();
    this.state = { ready: false, busy: false, error: '', mode: 'player', address: '', points: 0, chainId: 31337, contractAddress: '', channelId: '', inviteUrl: '', role: 0, black: '', white: '', stake: 10, status: 'idle', moves: [], pending: null, winner: 0, terminal: false, reason: '', nextPlayer: 1, deadline: 0, challengePeriod: 60, now: Math.floor(Date.now() / 1000), connected: false, peerConnected: false, autoAck: true, signatures: { black: '', white: '' }, digest: '', transactions: [], events: [], history: [], initialization: [], demoProgress: '', aiLevel: '', aiThinking: false, networkName: 'Gomoku Local EVM', metrics: metrics([], []) };
    this.state.persistence = { status: 'unknown', message: '' };
    try { this.state.history = this.repository.readHistory(); }
    catch (error) { this._historyError = readableError(error); this.state.error = this._historyError; }
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
    clearInterval(this._timer);
    this.config = await this._api('/api/config');
    this.domain = { name: 'GomokuChannel', version: '1', chainId: this.config.chainId, verifyingContract: this.config.address };
    this._emit({ ready: false, walletConnected: false, networkMode: this.config.mode, networkName: this.config.networkName, chainId: this.config.chainId, contractAddress: this.config.address, challengePeriod: this.config.challengePeriod });
    // External mode never creates a private key, funds an account, or submits a transaction on page load.
    if (this.config.mode === 'external') return;
    this.provider = new JsonRpcProvider(`${location.origin}/rpc`, undefined, { cacheTimeout: -1 }); this.provider.pollingInterval = 150;
    await this._checkNetwork(this.provider);
    let key = localStorage.getItem(`${STORE}:local-test-key`);
    if (!key) { key = Wallet.createRandom().privateKey; localStorage.setItem(`${STORE}:local-test-key`, key); }
    this.wallet = new Wallet(key, this.provider); this.contract = new Contract(this.config.address, this.config.abi, this.wallet);
    await this._prepareWallet(this.wallet);
    await this._startSession();
    this._log('本地测试钱包已就绪，积分由链上合约记账；节点由本机控制');
  }
  async _checkNetwork(provider) {
    let network;
    try { network = await provider.getNetwork(); } catch (error) {
      if (error.code === 'NETWORK_ERROR') throw Error(`钱包网络不符，请切换到链 ${this.config.chainId}`);
      throw error;
    }
    if (network.chainId !== BigInt(this.config.chainId)) throw Error(`钱包网络不符，请切换到链 ${this.config.chainId}`);
    const code = await provider.getCode(this.config.address);
    if (code === '0x') throw Error('目标地址没有合约代码');
    if (this.config.runtimeCodeHash && !same(keccak256(code), this.config.runtimeCodeHash)) throw Error('合约代码与已配置的部署指纹不符');
  }
  async connectExternalWallet(injected = globalThis.ethereum) {
    if (this.config?.mode !== 'external') throw Error('当前不是外部节点模式');
    await this._busy(async () => {
      if (!injected?.request) throw Error('请先安装兼容 EIP-1193 的浏览器钱包');
      this._removeWalletListeners(); this._closeSocket(); clearInterval(this._timer);
      this.provider?.destroy();
      this._walletEpoch = (this._walletEpoch || 0) + 1;
      this._injected = injected;
      this.wallet = null; this.contract = null;
      this._walletChanged = () => {
        this._walletEpoch++;
        clearInterval(this._timer); this._closeSocket(); this.contract = null; this.wallet = null;
        this._emit({ ready: false, walletConnected: false, error: '钱包账户或网络已变化，请重新连接；原签名证据已保留' });
      };
      injected.on?.('accountsChanged', this._walletChanged); injected.on?.('chainChanged', this._walletChanged);
      try {
        // Permission may legitimately emit accountsChanged; bind the session only after it resolves.
        const accounts = await injected.request({ method: 'eth_requestAccounts', params: [] });
        const epoch = this._walletEpoch;
        if (!accounts?.length) throw Error('钱包没有授权账户');
        this.provider = new BrowserProvider(injected, this.config.chainId, { cacheTimeout: -1 });
        await this._checkNetwork(this.provider);
        const signer = await this.provider.getSigner(accounts[0]);
        const current = await injected.request({ method: 'eth_accounts', params: [] });
        const chainId = await injected.request({ method: 'eth_chainId', params: [] });
        if (epoch !== this._walletEpoch || !same(current?.[0], signer.address) || BigInt(chainId) !== BigInt(this.config.chainId)) throw Error('连接期间钱包账户或网络已变化，请重新连接');
        this.wallet = signer;
        this.contract = new Contract(this.config.address, this.config.abi, signer);
        await this._startSession(epoch);
        this._log('已连接外部钱包；私钥由钱包保管，交易与签名需在钱包确认');
      } catch (error) {
        clearInterval(this._timer); this.wallet = null; this.contract = null;
        this._emit({ ready: false, walletConnected: false });
        this._removeWalletListeners();
        throw error;
      }
    });
    if (this.state.ready) await this._restoreSavedGame();
  }
  _removeWalletListeners() {
    if (this._injected && this._walletChanged) {
      this._injected.removeListener?.('accountsChanged', this._walletChanged);
      this._injected.removeListener?.('chainChanged', this._walletChanged);
    }
    this._injected = null; this._walletChanged = null;
  }
  async registerExternalWallet() {
    if (this.config?.mode !== 'external' || !this.wallet || !this.state.walletConnected) throw Error('请先连接外部钱包');
    await this._busy(async () => {
      if (!await this.contract.registered(this.wallet.address)) {
        const tx = await this.contract.register(), receipt = await tx.wait();
        if (receipt.status !== 1) throw Error('注册交易失败');
        this.state.initialization.push({ label: '钱包注册', hash: receipt.hash, gasUsed: receipt.gasUsed.toString() });
      }
    });
    await this._startSession();
  }
  async _startSession(epoch = this._walletEpoch) {
    const wallet = this.wallet, contract = this.contract;
    if (!wallet || !contract) throw Error('钱包连接已失效，请重新连接');
    const registered = await contract.registered(wallet.address);
    const points = Number(await contract.points(wallet.address));
    if (this.config.mode === 'external' && (epoch !== this._walletEpoch || wallet !== this.wallet || contract !== this.contract)) throw Error('连接期间钱包账户或网络已变化，请重新连接');
    this._emit({ address: wallet.address, walletConnected: true, ready: registered, points });
    clearInterval(this._timer);
    this._timer = setInterval(() => { this._emit({ now: Math.floor(Date.now() / 1000) }); if (!this._refreshing && !this.state.busy) this.refresh().catch(e => this._log(readableError(e), 'warning')); }, 2000);
    // Restoration acquires its own lock, so finish the explicit connect action first.
    if (registered && !this.state.busy) await this._restoreSavedGame();
  }
  async _restoreSavedGame() {
    // A newer AI game must not be displaced by an older multiplayer-room bookmark.
    if (this.config.mode !== 'external' && await this._resumeAi()) return;
    const saved = localStorage.getItem(`${STORE}:active-room:${this.config.address}`);
    if (saved) { try { await this.joinRoom(saved); } catch (e) {
      this._log(`中继恢复失败：${readableError(e)}`, 'warning');
      const activeId = localStorage.getItem(`${STORE}:active-channel:${this.config.address}`);
      try {
        const evidence = activeId && this.repository.readEvidence(activeId);
        if (evidence) { await this.importEvidence(evidence); this._log('已从本地证据恢复，可直接进行链上争议', 'success'); }
      } catch (restoreError) { this._log(readableError(restoreError), 'warning'); }
    } }
  }
  async _prepareWallet(wallet) {
    if (this.config.mode === 'external') throw Error('外部模式不提供本地注资或代管测试钱包');
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
    this._roomMayOpen = true;
    this._acknowledgedProposal = null;
    this._onchainSnapshot = null; this._transactionScanKey = null;
    this._checkpoint = { moves: [], sigBlack: '', sigWhite: '' }; this._room = null; this._demoId = null;
    this._emit({ mode: 'player', channelId: '', inviteUrl: '', role: 0, black: '', white: '', stake: 10, status: 'idle', moves: [], pending: null, winner: 0, terminal: false, reason: '', nextPlayer: 1, deadline: 0, proofDeadline: 0, signatures: { black: '', white: '' }, digest: '', transactions: [], transactionListComplete: false, events: [], demoProgress: '', aiLevel: '', aiThinking: false, peerConnected: false });
    this._ai = null;
    this._emit({ persistence: { status: 'unknown', message: '' } });
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
      if (['active', 'dispute', 'invited'].includes(this.state.status)) throw Error('请先结束当前房间，再加入其他对局');
      let id = input.trim(); if (id.includes('?')) id = new URL(id).searchParams.get('room') || id;
      const room = await this._api(`/api/rooms/${encodeURIComponent(id)}`);
      this._closeSocket(); this._resetGame(); await this._connect(room.roomId);
    });
  }
  _connect(roomId, { resume = false } = {}) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`); this.ws = ws;
      const wallet = this.wallet;
      const current = () => this.ws === ws && this.wallet === wallet;
      let authenticated = false, completed = false;
      const fail = error => {
        if (!completed) { completed = true; clearTimeout(timer); reject(error); }
      };
      const timer = setTimeout(() => { fail(Error('房间连接超时；已有签名仍保留')); ws.close(); }, 12000);
      this._cancelConnection = () => fail(Error('房间连接已取消；已有签名仍保留'));
      ws.onmessage = event => {
        if (!current()) return;
        let msg;
        try { msg = JSON.parse(event.data); }
        catch { fail(Error('中继返回了无效消息')); ws.close(); return; }
        if (msg.type === 'hello') {
          wallet.signMessage(relayAuthText(msg.nonce, roomId, this.config.chainId, this.config.address)).then(signature => {
            if (current() && ws.readyState === WebSocket.OPEN && !completed) ws.send(JSON.stringify({ type: 'auth', roomId, address: wallet.address, signature }));
          }).catch(error => { if (current()) { fail(error); ws.close(); } });
        } else if (msg.type === 'room') {
          this._handling = this._handling.then(async () => {
            if (!current() || ws.readyState !== WebSocket.OPEN) return;
            await this._onRoom(msg, { current, allowLifecycle: !resume });
            if (!current() || ws.readyState !== WebSocket.OPEN) return;
            if (!authenticated) {
              authenticated = true; completed = true; clearTimeout(timer);
              this._emit({ connected: true }); resolve();
            }
          }).catch(e => {
            if (!current()) return;
            fail(e); this._emit({ error: readableError(e) }); this._log(readableError(e), 'warning');
            if (!authenticated) ws.close();
          });
        } else if (msg.type === 'error') {
          if (!authenticated) { fail(Error(msg.message)); ws.close(); }
          this._emit({ error: msg.message }); this._log(msg.message, 'warning');
        }
      };
      ws.onerror = () => { if (!authenticated) { fail(Error('无法连接房间中继')); ws.close(); } };
      ws.onclose = () => { fail(Error('中继在连接完成前断开；已有签名仍保留')); clearTimeout(timer); if (current()) this._emit({ connected: false, peerConnected: false }); };
    });
  }
  _send(msg) { if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw Error('中继已断开；已有签名仍可用于链上争议'); this.ws.send(JSON.stringify(msg)); }
  _closeSocket() { this._cancelConnection?.(); this._cancelConnection = null; if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; } this._emit({ connected: false, peerConnected: false }); }
  async reconnectRelay() {
    return this._busy(async () => {
      if (!this.state.ready || this.state.mode !== 'player' || !this._room?.roomId) throw Error('当前没有可重连的双人房间；可从证据文件独立恢复');
      const roomId = this._room.roomId;
      this._closeSocket(); this._roomMayOpen = false;
      // Reconnecting authenticates and verifies state. It never reopens a channel
      // or automatically confirms a proposal that arrived while disconnected.
      this._emit({ autoAck: false });
      await this._connect(roomId, { resume: true });
      this._log('中继已重连，已保留并核对双签进度；自动确认已关闭，请手动检查待确认落子', 'success');
    });
  }
  _verifyCheckpoint(checkpoint, room) {
    evaluate(checkpoint.moves);
    if (!checkpoint.moves.length) return;
    verifyEvidence({ format: 'gomoku-channel-evidence/v1', domain: this.domain, channelId: room.channelId,
      participants: { black: room.black, white: room.white }, stake: room.stake, checkpoint });
  }
  async _onRoom({ room, peers }, { current = () => true, allowLifecycle = true } = {}) {
    if (!current()) return;
    if (room.cancelled) {
      if (room.channelId || room.white || this._room?.channelId || this._checkpoint.moves.length) throw Error('拒绝中继取消已匹配或已开通的对局');
      this._roomMayOpen = false;
      localStorage.removeItem(`${STORE}:active-room:${this.config.address}`);
      this._closeSocket(); this._resetGame();
      this._emit({ status: 'cancelled', connected: false });
      this._log('房间已取消，邀请链接已失效，未锁定积分', 'success');
      return;
    }
    const role = same(this.wallet.address, room.black) ? 1 : 2;
    if (room.channelId) {
      const expectedId = keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'address', 'bytes32'], [room.black, room.white, room.salt]));
      if (expectedId !== room.channelId) throw Error('房间身份与通道编号不匹配');
    }
    this._verifyCheckpoint(room.checkpoint, room);
    if (!isPrefix(this._checkpoint.moves, room.checkpoint.moves)) throw Error('拒绝中继回退或分叉已确认快照');
    if (room.channelId) this._protectCheckpoint({ format: 'gomoku-channel-evidence/v1', domain: this.domain,
      channelId: room.channelId, participants: { black: room.black, white: room.white }, stake: room.stake, checkpoint: room.checkpoint },
      { allowChannelTransition: same(this._room?.roomId, room.roomId) && !this._room?.channelId && same(this.state.channelId, room.roomId) });
    const url = new URL(location.href); url.search = ''; url.searchParams.set('room', room.roomId);
    const merged = [...this.state.transactions];
    for (const tx of room.transactions) if (!merged.some(t => same(t.hash, tx.hash))) {
      const receipt = await this.provider.getTransactionReceipt(tx.hash);
      if (!current()) return;
      if (!receipt || receipt.status !== 1 || !same(receipt.to, this.config.address) || !receipt.logs.some(log => {
        try { return same(log.address, this.config.address) && same(this.contract.interface.parseLog(log)?.args.id, room.channelId); } catch { return false; }
      })) throw Error('中继交易无法通过当前节点核验');
      const block = await this.provider.getBlock(receipt.blockNumber);
      if (!current()) return;
      merged.push({ ...tx, hash: receipt.hash, gasUsed: receipt.gasUsed.toString(), blockNumber: receipt.blockNumber, timestamp: block.timestamp });
    }
    this._room = structuredClone(room); this._checkpoint = structuredClone(room.checkpoint);
    localStorage.setItem(`${STORE}:active-room:${this.config.address}`, room.roomId);
    this._emit({ role, black: room.black, white: room.white, stake: room.stake, channelId: room.channelId || room.roomId, inviteUrl: url.toString(), peerConnected: peers.some(p => !same(p, this.wallet.address)), transactions: merged });
    this._applyCheckpoint();
    if (room.channelId) { if (allowLifecycle) await this._lifecycle(); else await this.refresh(); }
    else this._emit({ status: 'invited' });
    if (!current()) return;
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
    this._persistEvidence();
  }
  _persistEvidence() {
    if (!this.state.channelId) return;
    try {
      this.repository.saveEvidence(this.exportEvidence(), this.config.address);
      this._emit({ persistence: { status: 'saved', channelId: this.state.channelId, movesCount: this._checkpoint.moves.length, message: '' } });
    } catch (error) {
      // A newly verified signature must remain exportable even if disk storage
      // fails. Stop subsequent signing instead of silently accepting data loss.
      this._emit({ persistence: { status: 'failed', channelId: this.state.channelId, movesCount: this._checkpoint.moves.length, message: readableError(error) } });
    }
  }
  _assertCheckpointSaved() {
    if (this.state.persistence?.status === 'failed') throw Error(this.state.persistence.message);
  }
  async retryCheckpointSave() {
    return this._busy(async () => { this._persistEvidence(); this._assertCheckpointSaved(); });
  }
  async continueAiTurn() {
    return this._busy(async () => {
      this._assertCheckpointSaved();
      if (this.state.mode !== 'ai' || this.state.status !== 'active' || this.state.terminal || this.state.nextPlayer === this.state.role) throw Error('当前没有待继续的 AI 回合');
      await this._aiReply();
    });
  }
  async _lifecycle() {
    if (this._lifecycleBusy || !this._room?.channelId || this._roomMayOpen === false) return;
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
      const block = await this.provider.getBlock('latest');
      if (!block) throw Error('无法读取链上快照区块');
      const c = await this.contract.getChannel(id, { blockTag: block.number }), status = STATUS[Number(c.status)];
      this._onchainSnapshot = { status, moves: fromHex(c.moves), winner: Number(c.winner), reason: Number(c.reason), deadline: Number(c.deadline), proofDeadline: Number(c.proofDeadline || 0), blockNumber: block.number, blockHash: block.hash };
      this._emit({ now: block.timestamp, chainNow: block.timestamp, chainError: '' });
      if (Number(c.status) === 0) { this._emit({ points, status: 'invited' }); return; }
      if (this._room && (!same(c.black, this._room.black) || !same(c.white, this._room.white) || Number(c.stake) !== this._room.stake)) throw Error('链上参与者或积分与房间约定不符');
      if (Number(c.status) >= 3) {
        const moves = fromHex(c.moves), result = evaluate(moves);
        this._emit({ moves, winner: Number(c.winner), terminal: status === 'settled' || result.terminal, nextPlayer: result.nextPlayer, pending: null });
      }
      this._emit({ points, status, black: c.black, white: c.white, deadline: Number(c.deadline), proofDeadline: Number(c.proofDeadline || 0), reason: ['', '五子连珠', '满盘和棋', '超时判负', '主动认输'][Number(c.reason)] || '' });
      const scanKey = `${id}:${c.status}:${c.moves}:${c.deadline}:${c.proofDeadline || 0}`;
      if (!this.state.transactionListComplete || this._transactionScanKey !== scanKey) {
        this._emit({ transactionListComplete: false });
        const verified = await verifyEvidenceOnchain({ ...this.exportEvidence(), transactions: [] }, { provider: this.provider, contract: this.contract,
          expected: { chainId: this.config.chainId, verifyingContract: this.config.address, runtimeCodeHash: this.config.runtimeCodeHash, deploymentBlock: this.config.deploymentBlock } });
        const chain = verified.chain, verifiedStatus = STATUS[chain.status];
        this._transactionScanKey = `${id}:${chain.status}:${movesHex(chain.moves)}:${chain.deadline}:${chain.proofDeadline || 0}`;
        this._onchainSnapshot = { ...this._onchainSnapshot, status: verifiedStatus, moves: [...chain.moves], winner: chain.winner, reason: chain.reason,
          deadline: chain.deadline, proofDeadline: chain.proofDeadline || 0, blockNumber: chain.blockNumber, blockHash: chain.blockHash };
        this._emit({ transactions: verified.transactions, transactionListComplete: true, status: verifiedStatus, deadline: chain.deadline, proofDeadline: chain.proofDeadline || 0,
          ...(chain.status >= 3 ? { moves: [...chain.moves], winner: chain.winner, terminal: verifiedStatus === 'settled' || evaluate(chain.moves).terminal, nextPlayer: evaluate(chain.moves).nextPlayer } : {}) });
      }
      if (this.state.status === 'settled') this._saveHistory();
      if (this._room && (Number(c.status) === 0 && this.state.role === 1 || Number(c.status) === 1 && this.state.role === 2) && !this._lifecycleBusy) queueMicrotask(() => this._lifecycle().catch(e => this._log(readableError(e), 'warning')));
    } catch (error) {
      this._emit({ chainError: readableError(error) }); throw error;
    } finally { this._refreshing = false; }
  }
  async _transaction(transactionPromise, label) {
    const tx = await transactionPromise; this._log(`${label}：交易已提交，等待区块确认`);
    const receipt = await tx.wait(); if (receipt.status !== 1) throw Error('链上交易执行失败');
    const block = await this.provider.getBlock(receipt.blockNumber);
    const record = { label, hash: receipt.hash, gasUsed: receipt.gasUsed.toString(), blockNumber: receipt.blockNumber, timestamp: block.timestamp };
    if (!this.state.transactions.some(t => t.hash === record.hash)) { this.state.transactions.push(record); this.state.transactionListComplete = false; }
    this._log(`${label}已确认 · gas ${record.gasUsed}`, 'success');
    if (this._room && this.ws?.readyState === WebSocket.OPEN) this._send({ type: 'tx', hash: receipt.hash });
    return receipt;
  }
  async move(position) {
    this._assertCheckpointSaved();
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
  async acknowledge({ resend = false } = {}) {
    this._assertCheckpointSaved();
    const proposal = this._room?.proposal;
    if (!proposal || same(proposal.by, this.wallet.address)) throw Error('没有等待确认的对方提案');
    if (this._acking === movesHex(proposal.moves)) return;
    requireExtension(this._checkpoint.moves, proposal.moves);
    const key = movesHex(proposal.moves); this._acking = key;
    try {
      const identity = `${this._room.channelId}:${this.wallet.address}:${key}`;
      if (this._acknowledgedProposal?.identity === identity) {
        if (resend) this._send({ type: 'ack', signature: this._acknowledgedProposal.signature });
        return;
      }
      const signature = await this.wallet.signTypedData(this.domain, STATE_TYPES, { channelId: this._room.channelId, movesHash: keccak256(key) });
      this._send({ type: 'ack', signature });
      this._acknowledgedProposal = { identity, signature };
      this._log(`第${proposal.moves.length}手确认签名已发送，等待中继发布双签快照`, 'success');
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
      await this.refresh(); this._log('已进入证据提交期，先保留完整窗口接收最新双签；期满后才允许链上强制落子，随后另有一轮响应期限', 'warning');
    });
  }
  async forceMove(position) { return this._busy(async () => {
    const block = await this.provider.getBlock('latest');
    if (block.timestamp < Number(this.state.proofDeadline || 0)) throw Error('证据提交期尚未结束，请先提交最新双签状态');
    await this._transaction(this.contract.forceMove(this.state.channelId, position), '链上强制落子'); await this.refresh();
  }); }
  async claimTimeout() { return this._busy(async () => { await this._transaction(this.contract.claimTimeout(this.state.channelId), '超时结算'); await this.refresh(); }); }
  async cancelRoom() {
    return this._busy(async () => {
      if (this.state.status !== 'invited' || this.state.role !== 1) throw Error('当前不可取消房间');
      if (!this._room?.channelId && this._room) {
        if (!this.state.connected) throw Error('请先重连中继后取消房间');
        this._send({ type: 'cancel-room' });
        return;
      }
      await this._transaction(this.contract.cancelInvitation(this.state.channelId), '取消待加入邀请');
      await this.refresh();
    });
  }
  async resign() {
    return this._busy(async () => {
      if (![1, 2].includes(this.state.role) || !['active', 'dispute'].includes(this.state.status)) throw Error('当前不可认输');
      await this._transaction(this.contract.resign(this.state.channelId), '主动认输');
      await this.refresh();
    });
  }
  async returnToLobby() {
    if (!['settled', 'cancelled', 'idle'].includes(this.state.status)) throw Error('请先取消邀请或完成结算，再返回大厅');
    localStorage.removeItem(`${STORE}:active-room:${this.config.address}`);
    this._closeSocket(); this._resetGame();
    const url = new URL(location.href); url.searchParams.delete('room');
    history.replaceState(null, '', url);
  }
  async cancelUnjoined() {
    return this._busy(async () => {
      let signerContract = this.contract;
      if (this.state.mode === 'ai' && this.state.role === 2) {
        const c = await this.contract.getChannel(this.state.channelId);
        if (Number(c.status) !== 1) throw Error('通道已不是待加入邀请');
        if (this._ai?.humanRole !== 2 || !same(this._demoId, this.state.channelId) || !same(this._ai?.wallet?.address, c.black) || !same(this.wallet.address, c.white)) throw Error('AI 退款钱包与链上参与者不匹配');
        const latest = await this.provider.getBlock('latest');
        if (!latest || BigInt(latest.timestamp) < BigInt(c.deadline)) throw Error('邀请尚未到期');
        signerContract = this.contract.connect(this._ai.wallet);
      }
      await this._transaction(signerContract.cancelUnjoined(this.state.channelId), '取消超时邀请');
      await this.refresh();
    });
  }
  _saveHistory() {
    const record = { id: this.state.channelId, winner: this.state.winner, movesCount: this.state.moves.length, transactions: this.state.transactions.length, settledAt: new Date().toISOString(), mode: this.state.mode, gas: this.state.metrics.totalGas };
    const old = this.state.history.findIndex(h => h.id === record.id);
    if (old >= 0) { record.settledAt = this.state.history[old].settledAt; this.state.history[old] = record; }
    else this.state.history.unshift(record);
    if (this.state.mode === 'ai') { record.aiLevel = this.state.aiLevel; localStorage.removeItem(this._aiSessionKey()); }
    // Evidence is saved independently of the optional history index.
    this._persistEvidence();
    try { if (this._historyError) throw Error(this._historyError); this.repository.saveHistory(this.state.history); }
    catch (error) { this._emit({ archiveError: readableError(error) }); }
    this._emit();
  }
  exportEvidence() {
    return { format: 'gomoku-channel-evidence/v1', exportedAt: new Date().toISOString(), localTeachingOnly: this.config?.mode !== 'external',
      domain: this.domain, channelId: this.state.channelId, participants: { black: this.state.black, white: this.state.white }, stake: this.state.stake,
      // 人机局标注对手类型（说明性字段，不参与签名核验）。
      opponent: this.state.mode === 'ai' ? { type: 'local-ai', level: this.state.aiLevel, levelName: LEVELS[this.state.aiLevel]?.name || '' } : undefined,
      checkpoint: structuredClone(this._checkpoint), onchain: this._onchainSnapshot ? structuredClone(this._onchainSnapshot) : null,
      transactions: structuredClone(this.state.transactions), transactionListComplete: Boolean(this.state.transactionListComplete), initialization: structuredClone(this.state.initialization), metrics: structuredClone(this.state.metrics),
      trustBoundary: '积分无现实价值；独立保管签名快照，并在挑战期内监控链；中继不可代签；本地开发RPC不适合公网。' };
  }
  async _verifyEvidenceTransactions(evidence) {
    const verified = await verifyEvidenceOnchain(evidence, { provider: this.provider, contract: this.contract,
      expected: { chainId: this.config.chainId, verifyingContract: this.config.address, runtimeCodeHash: this.config.runtimeCodeHash, deploymentBlock: this.config.deploymentBlock } });
    return verified.transactions;
  }
  _protectCheckpoint(evidence, { allowChannelTransition = false } = {}) {
    const sameChannel = same(this.state.channelId, evidence.channelId);
    if (!sameChannel && !allowChannelTransition && ['invited', 'active', 'dispute'].includes(this.state.status)) throw Error('请先完成当前对局，不能用其他局证据替换活动状态');
    const previous = [];
    if (sameChannel && this._checkpoint?.moves?.length) previous.push(this._checkpoint);
    const old = this.repository.readEvidence(evidence.channelId);
    if (old) {
      verifyEvidence(old, { chainId: this.config.chainId, verifyingContract: this.config.address });
      if (!same(old.participants.black, evidence.participants.black) || !same(old.participants.white, evidence.participants.white) || old.stake !== evidence.stake) throw Error('通道参与者或积分与已保存证据不符；原证据已保留');
      previous.push(old.checkpoint);
    }
    for (const cp of previous) if (!isPrefix(cp.moves, evidence.checkpoint.moves)) throw Error('拒绝回退或分叉本地已保存的双签快照；原证据已保留');
  }
  async importEvidence(evidence) {
    return this._busy(async () => {
      const verified = await verifyEvidenceOnchain(evidence, { provider: this.provider, contract: this.contract,
        expected: { chainId: this.config.chainId, verifyingContract: this.config.address, runtimeCodeHash: this.config.runtimeCodeHash, deploymentBlock: this.config.deploymentBlock } });
      if (verified.chain.status < 2) throw Error('链上通道尚未开通');
      this._protectCheckpoint(evidence);
      this._closeSocket(); this._resetGame(); this._demoId = evidence.channelId;
      this._checkpoint = structuredClone(evidence.checkpoint);
      const role = same(this.wallet.address, verified.black) ? 1 : same(this.wallet.address, verified.white) ? 2 : 0;
      this._emit({ mode: 'player', channelId: evidence.channelId, role, black: verified.black, white: verified.white, stake: evidence.stake, transactions: verified.transactions, status: STATUS[verified.chain.status] });
      this._applyCheckpoint(); await this.refresh();
      this._log(`${verified.signed ? '快照双签已核验' : '空棋谱无双签'}；已从节点重建${verified.transactions.length}笔本局真实交易，原文件的统计不作依据`, 'success');
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
      if (this.config.mode === 'external') throw Error('外部钱包模式仅支持两位独立玩家，不启用本地AI代签');
      if (!Object.hasOwn(LEVELS, level)) throw Error('未知的 AI 难度');
      if (humanRole !== 1 && humanRole !== 2) throw Error('执子方须为黑方或白方');
      if (!Number.isSafeInteger(stake) || stake < 1) throw Error('对局积分须为正整数');
      if (['active', 'dispute', 'invited'].includes(this.state.status)) throw Error('请先完成当前对局再开始人机对弈');
      this._closeSocket(); this._resetGame();
      localStorage.removeItem(`${STORE}:active-room:${this.config.address}`);
      const ai = Wallet.createRandom().connect(this.provider);
      this._emit({ mode: 'ai', aiLevel: level, demoProgress: '正在准备 AI 对手的本地钱包' });
      await this._prepareWallet(ai);
      const salt = '0x' + Array.from(randomBytes(32), b => b.toString(16).padStart(2, '0')).join('');
      const black = humanRole === 1 ? this.wallet : ai, white = humanRole === 1 ? ai : this.wallet;
      const id = keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'address', 'bytes32'], [black.address, white.address, salt]));
      this._demoId = id; this._ai = { wallet: ai, level, humanRole };
      this._emit({ channelId: id, role: humanRole, black: black.address, white: white.address, stake, status: 'invited', demoProgress: '双方锁定积分' });
      // Save recovery credentials and an empty evidence checkpoint BEFORE any funds are locked.
      localStorage.setItem(this._aiSessionKey(), JSON.stringify({ key: ai.privateKey, channelId: id, level, humanRole }));
      this._applyCheckpoint();
      this._assertCheckpointSaved();
      try {
        await this._transaction(this.contract.connect(black).openChannel(white.address, stake, salt), '锁定黑方积分');
        this._applyCheckpoint(); // Preserve the confirmed open receipt even if the next step fails.
        await this._transaction(this.contract.connect(white).joinChannel(id), '锁定白方积分');
      } catch (e) {
        this._applyCheckpoint();
        await this.refresh().catch(refreshError => this._log(`链上状态暂不可查询：${readableError(refreshError)}`, 'warning'));
        this._log(`人机开通未完成；通道 ${id}；本地钱包与证据已保留。请刷新核对链上状态；若待加入且你执黑，可等待期限后使用“到期取消未加入邀请”退款。不会自动重试交易。`, 'warning');
        throw e;
      }
      this._emit({ status: 'active', connected: false, peerConnected: false, demoProgress: '' });
      this._applyCheckpoint(); await this.refresh();
      this._log(`人机对局开始：对手「${LEVELS[level].name}」，每手仍由双方 EIP-712 签名，链上只有开通与结算`, 'success');
      if (humanRole === 2) await this._aiReply();
    });
  }
  async _aiHumanMove(position) {
    return this._busy(async () => {
      this._assertCheckpointSaved();
      if (this.state.status !== 'active' || this.state.terminal) throw Error('当前对局不能落子');
      if (this.state.role !== this.state.nextPlayer) throw Error('请等待 AI 落子');
      const next = [...this._checkpoint.moves, position]; requireExtension(this._checkpoint.moves, next);
      this._checkpoint = await this._signBoth(next); this._applyCheckpoint();
      this._log(`第${next.length}手已由你和 AI 双方签名确认，全程未发送链上交易`, 'success');
      if (!this.state.terminal) await this._aiReply();
    });
  }
  async _aiReply() {
    this._assertCheckpointSaved();
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
    const raw = localStorage.getItem(this._aiSessionKey()); if (!raw) return false;
    try {
      return await this._busy(async () => {
        const s = JSON.parse(raw);
        if (!Object.hasOwn(LEVELS, s.level) || (s.humanRole !== 1 && s.humanRole !== 2)) throw Error('人机会话的难度或执子方无效');
        const activeId = localStorage.getItem(`${STORE}:active-channel:${this.config.address}`);
        if (activeId && !same(activeId, s.channelId)) throw Error('人机会话不是当前对局');
        const evidence = this.repository.readEvidence(s.channelId);
        if (!evidence) throw Error('缺少本地证据');
        const verified = verifyEvidence(evidence, { chainId: this.config.chainId, verifyingContract: this.config.address });
        if (!same(verified.channelId, s.channelId)) throw Error('人机会话与证据通道不匹配');
        const c = await this.contract.getChannel(s.channelId);
        if (![1, 2].includes(Number(c.status))) {
          // Dispute recovery may still need this wallet. Only a finished channel makes it disposable.
          if ([4, 5].includes(Number(c.status))) localStorage.removeItem(this._aiSessionKey());
          return false;
        }
        if (!same(c.black, verified.black) || !same(c.white, verified.white) || BigInt(c.stake) !== BigInt(evidence.stake)) throw Error('链上通道与人机证据参与者或积分不匹配');
        const ai = new Wallet(s.key, this.provider);
        const humanAddress = s.humanRole === 1 ? c.black : c.white;
        const aiAddress = s.humanRole === 1 ? c.white : c.black;
        if (!same(this.wallet.address, humanAddress) || !same(ai.address, aiAddress)) throw Error('人机钱包身份与链上执子方不匹配');
        // Verify everything before installing the session or signing any further moves.
        const transactions = await this._verifyEvidenceTransactions(evidence);
        this._closeSocket(); this._resetGame();
        this._ai = { wallet: ai, level: s.level, humanRole: s.humanRole };
        this._demoId = s.channelId; this._checkpoint = structuredClone(evidence.checkpoint);
        this._emit({ mode: 'ai', aiLevel: s.level, channelId: s.channelId, role: s.humanRole, black: c.black, white: c.white, stake: evidence.stake, status: STATUS[Number(c.status)], deadline: Number(c.deadline || 0), transactions });
        this._applyCheckpoint(); await this.refresh();
        if (Number(c.status) === 1) {
          this._log(`已恢复待加入的人机通道 ${s.channelId}，不会自动补发交易。${s.humanRole === 1 ? '你是黑方，期限届满后可使用“到期取消未加入邀请”退款。' : '开通方是本地 AI 钱包；其恢复密钥已保留，请勿清除浏览器数据。'}`, 'warning');
        } else {
          this._log('已恢复未完成的人机对局（已核验双签、链上参与者、双方钱包与交易回执）', 'success');
          if (!this.state.terminal && this.state.status === 'active' && this._checkpoint.moves.length % 2 + 1 !== s.humanRole) await this._aiReply();
        }
        return true;
      });
    } catch (e) {
      // An unavailable RPC or malformed evidence must not delete the only copy of the AI wallet.
      this._log(`人机对局恢复失败，已保留本地会话以便重试：${readableError(e)}`, 'warning'); return false;
    }
  }
  async runDemo() {
    return this._busy(async () => {
      if (this.config.mode === 'external') throw Error('外部钱包模式禁止脚本双钱包自动演示，请创建双人对局');
      if (['active', 'dispute', 'invited'].includes(this.state.status)) throw Error('请先完成或取消当前对局');
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
        this._assertCheckpointSaved();
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
  destroy() { clearInterval(this._timer); this._removeWalletListeners(); this._closeSocket(); this.provider?.destroy(); this.listeners.clear(); }
}
