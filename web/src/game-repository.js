// Owns the on-disk representation. It never signs, deletes damaged evidence, or
// substitutes an empty record for a failed read. Web Storage setItem is atomic
// for one key; the active-channel bookmark is a separate, recoverable hint.
const PREFIX = 'gomoku-channel-v1';

export class GameRepository {
  constructor(storage = () => globalThis.localStorage) { this.storage = storage; }
  _read(key) {
    try { return this.storage().getItem(`${PREFIX}:${key}`); }
    catch { throw Error('浏览器禁止读取本地存储；请保留当前页面并导出证据'); }
  }
  _json(key) {
    const raw = this._read(key);
    if (raw === null) return null;
    try { return JSON.parse(raw); }
    catch { throw Error('本地记录已损坏；原文已保留，请先导出当前证据'); }
  }
  _write(key, value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    try {
      this.storage().setItem(`${PREFIX}:${key}`, text);
      if (this.storage().getItem(`${PREFIX}:${key}`) !== text) throw Error('readback mismatch');
    } catch { throw Error('本地保存失败，可能空间不足或存储被禁用；请保持页面打开并导出证据，再重试保存'); }
  }
  readEvidence(channelId) { return this._json(`evidence:${channelId}`); }
  saveEvidence(evidence, contractAddress) {
    if (!evidence?.channelId) throw Error('缺少对局编号，无法保存证据');
    this._write(`evidence:${evidence.channelId}`, evidence);
    this._write(`active-channel:${contractAddress}`, evidence.channelId);
  }
  readHistory() {
    const records = this._json('history');
    if (records === null) return [];
    if (!Array.isArray(records) || records.some(x => !x || typeof x.id !== 'string')) throw Error('本地历史格式损坏；原文已保留，暂停覆盖历史');
    return records;
  }
  saveHistory(records) { this._write('history', records); }
}
