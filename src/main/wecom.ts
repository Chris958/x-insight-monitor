import { ClaimResult, StoredPost } from './types.js';

export const utf8Bytes = (value: string) => Buffer.byteLength(value, 'utf8');

export function truncateUtf8(value: string, maxBytes: number, suffix = '…'): string {
  if (utf8Bytes(value) <= maxBytes) return value;
  const suffixBytes = utf8Bytes(suffix);
  let output = '';
  for (const char of value) {
    if (utf8Bytes(output) + utf8Bytes(char) + suffixBytes > maxBytes) break;
    output += char;
  }
  return output + suffix;
}

export function splitMarkdown(text: string, maxBytes = 3500): string[] {
  if (utf8Bytes(text) <= maxBytes) return [text];
  const chunks: string[] = [];
  let current = '';
  const flush = () => { if (current) chunks.push(current); current = ''; };
  for (const block of text.split(/\n\n/)) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (utf8Bytes(candidate) <= maxBytes) { current = candidate; continue; }
    flush();
    let segment = '';
    for (const char of block) {
      if (utf8Bytes(segment) + utf8Bytes(char) > maxBytes) { chunks.push(segment); segment = ''; }
      segment += char;
    }
    current = segment;
  }
  flush();
  return chunks;
}

export function validateWeComWebhook(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new Error('企业微信机器人 Webhook 格式无效'); }
  if (url.protocol !== 'https:' || url.hostname !== 'qyapi.weixin.qq.com' || url.pathname !== '/cgi-bin/webhook/send' || !url.searchParams.get('key')) {
    throw new Error('请填写企业微信群机器人生成的完整 Webhook 地址');
  }
  return url.toString();
}

async function parseResponse(res: Response, label: string) {
  let body: Record<string, any>;
  try { body = await res.json() as Record<string, any>; }
  catch { throw new Error(`${label}: 企业微信返回了无法解析的响应（HTTP ${res.status}）`); }
  if (!res.ok || body.errcode !== 0) throw new Error(`${label}: ${body.errmsg || `HTTP ${res.status}`}`);
}

export class WeComWebhookClient {
  private webhook: string;

  constructor(webhook: string) { this.webhook = validateWeComWebhook(webhook); }

  async sendMarkdown(text: string) {
    const chunks = splitMarkdown(text);
    for (let i = 0; i < chunks.length; i++) {
      const prefix = chunks.length > 1 ? `**(${i + 1}/${chunks.length})**\n` : '';
      const res = await fetch(this.webhook, {
        method:'POST', headers:{ 'content-type':'application/json' },
        body:JSON.stringify({ msgtype:'markdown', markdown:{ content:prefix + chunks[i] } })
      });
      await parseResponse(res, '企业微信机器人推送失败');
    }
  }

  async test() {
    await this.sendMarkdown('## X Insight Monitor\n> 企业微信机器人 Webhook 连接成功\n\n实时快讯、完整分析报告和每日汇总将通过此机器人发送。');
  }
}

export function renderRealtimeText(post: StoredPost, timezone: string) {
  const time = new Intl.DateTimeFormat('zh-CN', { dateStyle:'medium', timeStyle:'medium', timeZone:timezone }).format(new Date(post.publishedAt));
  return `## X监控快讯｜@${post.username}\n> ${time}\n\n${post.translation?.summaryZh || '已发现新帖子'}\n\n${post.translation?.translatedText || ''}\n\n[查看 X 原帖](${post.url})\n\n> 事实核查进行中，完成后将继续推送分析报告。`;
}

function renderClaimMarkdown(post: StoredPost, result: ClaimResult, index: number) {
  const claim = post.claims?.find(item => item.id === result.claimId);
  const sources = result.evidence.length
    ? result.evidence.map(source => `   - [${source.title}](${source.url})（${source.publisher}）`).join('\n')
    : '   - 无可用外部来源';
  return `**${index + 1}. ${claim?.claim || ''}**\n> 结论：${result.verdict}｜证据充分度：${result.confidence}\n\n${result.rationale}\n\n${sources}`;
}

const bullets = (items?: string[]) => items?.length ? items.map(item => `- ${item}`).join('\n') : '- 无';

export function renderReportMarkdown(post: StoredPost) {
  const claims = (post.claimResults || []).map((result, index) => renderClaimMarkdown(post, result, index)).join('\n\n');
  return `## @${post.username} 事实审查｜${post.overallResult || '分析完成'}\n\n**中文摘要**\n${post.translation?.summaryZh || '—'}\n\n**中文翻译**\n${post.translation?.translatedText || '—'}\n\n**总体判断**\n> ${post.overallResult || '请查看分项结论'}\n\n**观点与逻辑**\n${post.logic?.conclusion || '无实质观点'}\n\n**逻辑风险**\n${bullets(post.logic?.reasoningGaps)}\n\n**替代解释**\n${bullets(post.logic?.alternativeExplanations)}\n\n**事实核查**\n${claims || '没有需要核查的事实主张'}\n\n**局限**\n${bullets(post.limitations)}\n\n[查看 X 原帖](${post.url})`;
}

export function renderDailySummary(posts: StoredPost[], date: string) {
  const completed = posts.filter(post => post.status === 'REPORT_COMPLETE' || post.status === 'REPORT_SENT');
  const failed = posts.filter(post => post.status === 'FAILED_FINAL');
  const rows = posts.slice(0, 30).map((post, index) => `${index + 1}. **@${post.username}**｜${post.overallResult || post.status}\n   ${truncateUtf8(post.translation?.summaryZh || post.text, 240)}\n   [原帖](${post.url})`).join('\n\n');
  return `## X Insight Monitor｜${date} 每日汇总\n> 新帖 ${posts.length}｜完成 ${completed.length}｜失败 ${failed.length}\n\n${rows || '今日暂无新帖'}${posts.length > 30 ? `\n\n> 另有 ${posts.length - 30} 条，请在桌面应用查看完整历史。` : ''}`;
}
