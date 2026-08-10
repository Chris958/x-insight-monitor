import { ClaimResult, StoredPost } from './types.js';

export function splitMarkdown(text: string, max = 3500): string[] {
  if (text.length <= max) return [text];
  const blocks = text.split(/\n\n/); const chunks: string[] = []; let current = '';
  for (const block of blocks) {
    if (`${current}\n\n${block}`.length <= max) current += `${current ? '\n\n' : ''}${block}`;
    else { if (current) chunks.push(current); current = block; while (current.length > max) { chunks.push(current.slice(0,max)); current = current.slice(max); } }
  }
  if (current) chunks.push(current); return chunks;
}

export class WeComClient {
  constructor(private webhook: string) {}
  async send(text: string) {
    const chunks = splitMarkdown(text);
    for (let i=0;i<chunks.length;i++) {
      const content = chunks.length > 1 ? `**(${i+1}/${chunks.length})**\n${chunks[i]}` : chunks[i];
      const res = await fetch(this.webhook, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({msgtype:'markdown',markdown:{content}}) });
      const body = await res.json() as any;
      if (!res.ok || body.errcode !== 0) throw new Error(`企业微信推送失败: ${body.errmsg || res.status}`);
    }
  }
  async test() { await this.send('**X Insight Monitor**\n配置测试成功，企业微信推送链路正常。'); }
}

export function renderFlash(post: StoredPost, timezone: string) {
  const time = new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'medium',timeZone:timezone}).format(new Date(post.publishedAt));
  return `## 【X 监控快讯】@${post.username}\n> 时间：${time} · 类型：${post.postType}\n\n**中文摘要**\n${post.translation?.summaryZh}\n\n**中文翻译**\n${post.translation?.translatedText}\n\n[查看原帖](${post.url})\n\n> 状态：深度分析与事实核查中`;
}

function renderClaim(post: StoredPost, result: ClaimResult, index: number) {
  const claim = post.claims?.find(c => c.id === result.claimId); const sources = result.evidence.map(e => `[${e.title}](${e.url})`).join(' · ') || '无可用来源';
  return `**${index+1}. ${claim?.claim || ''}**\n结论：${result.verdict}｜证据充分度：${result.confidence}\n依据：${result.rationale}\n来源：${sources}`;
}

export function renderReport(post: StoredPost) {
  const logic = post.logic; const claims = (post.claimResults || []).map((r,i) => renderClaim(post,r,i)).join('\n\n');
  return `## 【X 观点与事实核查】@${post.username}\n**总体结论：${post.overallResult || '请查看分项'}**\n\n**观点与逻辑**\n${logic?.conclusion || '无实质观点'}\n${logic?.reasoningGaps?.length ? `\n逻辑风险：${logic.reasoningGaps.join('；')}` : ''}\n${logic?.alternativeExplanations?.length ? `\n替代解释：${logic.alternativeExplanations.join('；')}` : ''}\n\n**事实主张**\n${claims || '没有需要核查的事实主张'}\n\n**局限**\n${post.limitations?.join('；') || '无'}\n\n[查看原帖](${post.url})`;
}
