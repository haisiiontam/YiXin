/** Read-only presentation policy. Chain timestamps, never the wall clock, decide
 * dispute stages. Advice is not authority to sign or send a transaction. */
export function recoveryGuide(state) {
  const count = state.moves?.length || 0;
  if (state.persistence?.status === 'failed') return {
    stage: 'storage', tone: 'danger', title: '先保护这份棋谱',
    detail: '最新签名仍在当前页面，尚未可靠保存。已暂停继续签名。',
    steps: ['保持页面打开，先下载本局证据备份。', '释放浏览器存储空间或恢复存储权限，再点“重试本地保存”。'],
  };
  if (!state.ready) return { stage: 'wallet', tone: 'warning', title: '先恢复钱包连接', detail: '账户或网络尚未就绪；请使用原参与钱包连接指定网络。', steps: ['不要清除浏览器数据。', '连接后核对原通道编号与棋谱，再继续操作。'] };
  if (state.status === 'dispute') {
    if (!Number.isFinite(state.chainNow) || state.chainError) return { stage: 'rpc', tone: 'warning', title: '先刷新链上状态', detail: '节点时间尚未读取或最近一次刷新失败，暂不推断争议阶段。', steps: ['保留证据，检查节点连接。', '在异常实验中刷新状态，再查看举证与响应期限。'] };
    const now = state.chainNow, proof = Number(state.proofDeadline || 0), deadline = Number(state.deadline || 0);
    if (now < proof) return { stage: 'proof', tone: 'warning', title: '正在举证，先保护最新双签', detail: `按最近链上时间，举证期尚余 ${proof - now} 秒。当前不能强制落子。`, steps: ['如有更新的双签，使用“签名与异常实验”提交最新快照。', '保持在线，刷新节点状态，等待举证期结束。'] };
    if (now < deadline) return { stage: 'response', tone: 'warning', title: '已进入链上落子响应期', detail: `按最近链上时间，响应期尚余 ${deadline - now} 秒。`, steps: [state.role === state.nextPlayer ? '轮到你：在异常实验中开启链上强制落子，再检查坐标。' : '等待对方响应，同时保留证据并监控节点。', '期限以合约为准；链上操作需要单独确认交易。'] };
    return { stage: 'timeout', tone: 'warning', title: '响应期限已到，请核对结算', detail: '超时胜方由合约按轮次确定，点击领取不代表领取者必胜。', steps: ['先刷新节点状态。', '参与者可在异常实验中请求超时结算，核对实际积分与回执。'] };
  }
  if (['settled', 'cancelled'].includes(state.status)) return { stage: 'finished', tone: 'success', title: state.status === 'settled' ? '本局已结算，留好凭据' : '邀请已取消', detail: `本地显示 ${count} 手；保存签名与节点回执，便于以后复核。`, steps: ['备份本局证据；文件不包含钱包私钥。', state.archiveError ? `历史索引保存异常：${state.archiveError}` : '对局记录仅在当前浏览器保留，下载备份更稳妥。'] };
  if (state.mode === 'player' && !state.connected) return { stage: 'relay', tone: 'warning', title: '中继断开，已有双签仍然保留', detail: `已确认 ${count} 手；重连会核对原进度并关闭自动确认。`, steps: ['先备份证据，再尝试原房间重连。', '若无法重连，RPC 可用时仍可通过异常实验发起链上争议。'] };
  if (state.pending) return { stage: 'pending', tone: 'warning', title: '这一手还未共同确认', detail: `只有前 ${count} 手属于已确认棋谱，半透明棋子仍是提案。`, steps: ['检查提案坐标与轮次；对方提案可手动签名确认。', '长期无回应时先备份，再考虑异常实验中的争议入口。'] };
  if (state.terminal) return { stage: 'terminal', tone: 'success', title: '棋局结束，积分尚待结算', detail: '胜负棋谱与积分到账是两个步骤。', steps: ['参与者点击“链上结算本局”。', '等待回执与积分刷新，再备份最终证据。'] };
  return { stage: 'playing', tone: 'success', title: state.status === 'invited' ? '等待双方开通' : '对局进度有据可查', detail: count ? `当前已确认 ${count} 手，签名与未确认提案分别显示。` : '空棋谱还没有落子双签。', steps: ['可随时下载证据备份；关闭页面前先确认已保存。', '遇到拒签或离线，展开异常实验查看恢复入口。'] };
}
