import express from 'express';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { AbiCoder, keccak256, verifyTypedData, verifyMessage, getAddress } from 'ethers';
import { initializeChain } from './chain-runtime.mjs';
import { STATE_TYPES, movesHex, requireExtension, relayAuthText } from '../shared/gomoku.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function createApplication({ env = process.env, artifact } = {}) {
const runtime = await initializeChain({ env, artifact });
const { provider, contract, domain, deployment, chainId: CHAIN_ID, runtimeDir: RUNTIME } = runtime;
const PORT = Number(env.PORT || 4173);
// 默认只监听回环；容器里需要设 HOST=0.0.0.0 才能被端口映射到。
const HOST = env.HOST || '127.0.0.1';
const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  ...(env.EXTRA_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
]);
let rooms = new Map();
try { rooms = new Map(JSON.parse(await fs.readFile(path.join(RUNTIME, 'rooms.json'), 'utf8')).map(r => [r.roomId, r])); } catch {}
let saveQueue = Promise.resolve();
function saveRooms() {
  const data = JSON.stringify([...rooms.values()], null, 2);
  const target = path.join(RUNTIME, 'rooms.json');
  const temp = `${target}.${process.pid}.tmp`;
  // 先写临时文件再 rename，避免断电/崩溃留下半截 JSON。
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    await fs.writeFile(temp, data);
    await fs.rename(temp, target);
  });
  return saveQueue;
}
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '128kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // This local teaching service deliberately permits only its own browser origin.
  if (req.headers.origin && !ALLOWED_ORIGINS.has(req.headers.origin)) return res.status(403).json({ error: '仅允许本地应用来源' });
  next();
});
// Only explicitly listed read calls and client-signed raw transactions reach the chain.
app.post('/rpc', async (req, res) => {
  async function execute(item) {
    const id = typeof item?.id === 'string' || typeof item?.id === 'number' || item?.id === null ? item.id : null;
    if (!item || item.jsonrpc !== '2.0' || typeof item.method !== 'string' || (item.params !== undefined && !Array.isArray(item.params))) return { jsonrpc: '2.0', id, error: { code: -32600, message: 'JSON-RPC 请求格式无效' } };
    try { return { jsonrpc: '2.0', id, result: await runtime.rpcRequest(item.method, item.params || []) }; }
    catch (e) { return { jsonrpc: '2.0', id, error: { code: e.code || -32000, message: runtime.publicError(e) } }; }
  }
  if (Array.isArray(req.body) && (!req.body.length || req.body.length > 50)) return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'RPC 批量请求须为 1 至 50 项' } });
  res.json(Array.isArray(req.body) ? await Promise.all(req.body.map(execute)) : await execute(req.body));
});
app.get('/api/config', (req, res) => res.json(runtime.config));
app.get('/api/health', (req, res) => res.json({ ok: true, mode: runtime.config.mode, chainId: CHAIN_ID, contractAddress: deployment.address }));
// 水龙头限流：同一地址 10 秒内不重复注资（返回当前余额，幂等不影响客户端初始化），
// 同一来源 IP 每小时最多 120 次新注资，挡掉批量脚本刷地址的女巫行为。
const FAUCET_ADDRESS_MS = 10 * 1000;
const FAUCET_IP_RECORDS = new Map();
const FAUCET_IP_LIMIT = 120;
const FAUCET_IP_WINDOW_MS = 60 * 60 * 1000;
const faucetLastByAddress = new Map();
function faucetIpAllowed(ip, now) {
  const rec = FAUCET_IP_RECORDS.get(ip);
  if (!rec || now - rec.start >= FAUCET_IP_WINDOW_MS) { FAUCET_IP_RECORDS.set(ip, { start: now, count: 0 }); return true; }
  return rec.count < FAUCET_IP_LIMIT;
}
app.post('/api/faucet', async (req, res, next) => {
  if (runtime.mode !== 'local') return res.status(403).json({ error: 'external 模式不提供测试币水龙头', mode: 'external' });
  try {
    const address = getAddress(req.body.address);
    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const last = faucetLastByAddress.get(address);
    const cooling = last !== undefined && now - last < FAUCET_ADDRESS_MS;
    let funded = false;
    if (!cooling) {
      if (!faucetIpAllowed(ip, now)) return res.status(429).json({ error: '测试币领取过于频繁，请稍后再试' });
      // Local EVM testing RPC, no real funds and no hidden funding transaction.
      await runtime.fundLocalAddress(address);
      FAUCET_IP_RECORDS.get(ip).count += 1;
      faucetLastByAddress.set(address, now);
      funded = true;
    }
    res.json({ address, balance: (await provider.getBalance(address)).toString(), method: 'evm_setAccountBalance', localOnly: true, funded, throttled: !funded });
  } catch (e) { next(e); }
});
app.post('/api/rooms', async (req, res, next) => {
  try {
    const black = getAddress(req.body.address), stake = Number(req.body.stake);
    if (!Number.isSafeInteger(stake) || stake < 1 || stake > 1000) throw Error('对局积分须为1至1000的整数');
    const roomId = '0x' + randomBytes(32).toString('hex');
    const room = { roomId, black, white: '', stake, salt: roomId, channelId: '', createdAt: new Date().toISOString(), checkpoint: { moves: [], sigBlack: '', sigWhite: '' }, proposal: null, transactions: [] };
    rooms.set(roomId, room); await saveRooms(); res.json(room);
  } catch (e) { next(e); }
});
app.get('/api/rooms/:id', (req, res) => {
  const room = rooms.get(req.params.id) || [...rooms.values()].find(r => r.channelId === req.params.id);
  if (!room) return res.status(404).json({ error: '未找到对局，请核对邀请码' });
  res.json(room);
});
app.use(express.static(path.join(ROOT, 'web/dist')));
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'web/dist/index.html')));
app.use((err, req, res, next) => { const message = runtime.publicError(err); console.error('Request:', message); res.status(400).json({ error: message }); });
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 32768 });
function broadcast(roomId) {
  const room = rooms.get(roomId);
  const peers = [...wss.clients].filter(c => c.roomId === roomId && c.readyState === WebSocket.OPEN);
  for (const c of peers) c.send(JSON.stringify({ type: 'room', room, peers: [...new Set(peers.map(p => p.address))] }));
}
function checkSignature(room, moves, signature, expected) {
  const actual = verifyTypedData(domain, STATE_TYPES, { channelId: room.channelId, movesHash: keccak256(movesHex(moves)) }, signature);
  if (actual.toLowerCase() !== expected.toLowerCase()) throw Error('签名与棋手身份不符');
}
wss.on('connection', (socket, req) => {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) { socket.close(1008, 'origin'); return; }
  const nonce = randomBytes(24).toString('hex');
  socket.send(JSON.stringify({ type: 'hello', nonce }));
  const authTimer = setTimeout(() => { if (!socket.address) socket.close(1008, 'auth timeout'); }, 15000);
  let queue = Promise.resolve();
  socket.on('message', data => { queue = queue.then(async () => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'auth') {
      if (socket.address) throw Error('连接已认证');
      const room = rooms.get(msg.roomId);
      if (!room || room.cancelled) throw Error('房间不存在或已取消');
      const address = getAddress(msg.address);
      const signer = verifyMessage(relayAuthText(nonce, room.roomId, CHAIN_ID, deployment.address), msg.signature);
      if (signer !== address) throw Error('连接认证失败');
      if (address !== room.black && room.white && address !== room.white) throw Error('房间已有两位棋手');
      if (address !== room.black && !room.white) {
        room.white = address;
        room.channelId = keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'address', 'bytes32'], [room.black, room.white, room.salt]));
      }
      socket.address = address; socket.roomId = room.roomId; clearTimeout(authTimer);
      await saveRooms(); broadcast(room.roomId); return;
    }
    if (!socket.address) throw Error('请先认证');
    const room = rooms.get(socket.roomId);
    if (msg.type === 'cancel-room') {
      if (socket.address !== room.black || room.white || room.channelId) throw Error('只有房主可取消尚未匹配的房间');
      room.cancelled = true;
      await saveRooms(); broadcast(socket.roomId); return;
    }
    if (room.cancelled) throw Error('房间已取消');
    if (msg.type === 'sync') { broadcast(socket.roomId); return; }
    if (msg.type === 'propose') {
      if (!room.channelId || Number((await contract.getChannel(room.channelId)).status) !== 2) throw Error('通道尚未激活或已进入争议');
      if (room.proposal) throw Error('请先确认当前提案');
      requireExtension(room.checkpoint.moves, msg.moves);
      const mover = room.checkpoint.moves.length % 2 === 0 ? room.black : room.white;
      if (mover !== socket.address) throw Error('尚未轮到你落子');
      checkSignature(room, msg.moves, msg.signature, mover);
      room.proposal = { moves: msg.moves, signature: msg.signature, by: mover };
    } else if (msg.type === 'ack') {
      const p = room.proposal;
      if (!p || p.by === socket.address) throw Error('没有等待你确认的提案');
      checkSignature(room, p.moves, msg.signature, socket.address);
      room.checkpoint = { moves: p.moves, sigBlack: p.by === room.black ? p.signature : msg.signature, sigWhite: p.by === room.white ? p.signature : msg.signature };
      room.proposal = null;
    } else if (msg.type === 'tx') {
      const receipt = await provider.getTransactionReceipt(msg.hash);
      if (!receipt || receipt.status !== 1 || receipt.to?.toLowerCase() !== deployment.address.toLowerCase()) throw Error('交易尚未成功或目标合约不符');
      const events = receipt.logs.filter(l => l.address.toLowerCase() === deployment.address.toLowerCase()).map(l => { try { return contract.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
      if (!events.some(e => e.args.id === room.channelId)) throw Error('交易不属于本局');
      if (!room.transactions.some(t => t.hash === receipt.hash)) {
        const block = await provider.getBlock(receipt.blockNumber);
        const labelMap = { ChannelOpened: '锁定黑方积分', ChannelJoined: '锁定白方积分', ChannelSettled: '结算积分', CheckpointChallenged: '提交争议快照', ForcedMove: '链上强制落子', ChannelCancelled: '退回邀请积分' };
        const lastEvent = events.find(e => e.name === 'ChannelSettled') || events.at(-1);
        room.transactions.push({ label: labelMap[lastEvent?.name] || '链上交易', hash: receipt.hash, gasUsed: receipt.gasUsed.toString(), blockNumber: receipt.blockNumber, timestamp: block.timestamp });
      }
    } else throw Error('未知消息类型');
    await saveRooms(); broadcast(socket.roomId);
  }).catch(e => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'error', message: runtime.publicError(e) })); }); });
  socket.on('close', () => { clearTimeout(authTimer); if (socket.roomId) broadcast(socket.roomId); });
});
let shuttingDown = false;
return {
  app, server, runtime,
  async listen(port = PORT, host = HOST) {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.removeListener('error', reject); resolve(); }); });
    const address = server.address();
    ALLOWED_ORIGINS.add(`http://127.0.0.1:${address.port}`);
    ALLOWED_ORIGINS.add(`http://localhost:${address.port}`);
    return address;
  },
  async close() {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const c of wss.clients) c.terminate();
    try {
      await Promise.all([
        saveQueue,
        new Promise(resolve => wss.close(resolve)),
        server.listening ? new Promise(resolve => server.close(resolve)) : Promise.resolve(),
      ]);
    } finally { await runtime.close(); }
  },
};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let application;
  try {
    application = await createApplication();
    const address = await application.listen();
    console.log(`Gomoku Channel Lab: http://127.0.0.1:${address.port}\n${application.runtime.config.mode} chain ${application.runtime.chainId}; contract ${application.runtime.deployment.address}\nAll mutable data: ${application.runtime.runtimeDir}`);
    const shutdown = async () => { await application.close(); process.exit(0); };
    process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  } catch (error) { console.error(application ? application.runtime.publicError(error) : error.message); await application?.close(); process.exitCode = 1; }
}
