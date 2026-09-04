import { StoredPost } from './types.js';

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
  return `## X监控快讯｜@${post.username}\n> ${time}\n\n**核心观点**\n${post.translation?.summaryZh || '已发现新帖子'}\n\n[查看 X 原帖](${post.url})\n\n> 正在核查核心观点及潜在受益方向。`;
}

const bullets = (items?: string[]) => items?.length ? items.map(item => `- ${item}`).join('\n') : '- 无';

export function renderReportMarkdown(post: StoredPost) {
  const review=post.investmentReview;
  if (!review) return `## @${post.username}｜分析未完成\n\n${post.translation?.summaryZh || '暂无摘要'}\n\n[查看 X 原帖](${post.url})`;
  const industries=review.beneficiaryIndustries.length
    ? review.beneficiaryIndustries.map(item => `- **${item.name}**：${item.rationale}`).join('\n') : '- 暂无明确方向';
  const companies=review.beneficiaryCompanies.length
    ? review.beneficiaryCompanies.map(item => `- **${item.name}**（${item.ticker} · ${item.market}）｜${item.confidence}\n  ${item.rationale}`).join('\n') : '- 暂无足够证据确认具体公司';
  const sources=review.evidence.length
    ? review.evidence.map(item => `- [${item.title}](${item.url})（${item.publisher}）`).join('\n') : '- 无可用外部证据';
  return `## @${post.username}｜${review.verdict}\n\n**核心观点**\n${review.coreViewpoint}\n\n**审查结论**\n> ${review.verification}\n\n**可能利好行业**\n${industries}\n\n**可能受益公司**\n${companies}\n\n**关键风险**\n${bullets(review.risks)}\n\n**主要依据**\n${sources}\n\n[查看 X 原帖](${post.url})`;
}

export function renderDailySummary(posts: StoredPost[], date: string) {
  const completed = posts.filter(post => post.status === 'REPORT_COMPLETE' || post.status === 'REPORT_SENT');
  const failed = posts.filter(post => post.status === 'FAILED_FINAL');
  const rows = posts.slice(0, 30).map((post, index) => {
    const review=post.investmentReview;
    const industries=review?.beneficiaryIndustries.map(item => item.name).join('、') || '暂无明确行业';
    const companies=review?.beneficiaryCompanies.slice(0,3).map(item => `${item.name}(${item.ticker})`).join('、') || '暂无明确公司';
    return `${index + 1}. **@${post.username}**｜${review?.verdict || post.status}\n   ${truncateUtf8(review?.coreViewpoint || post.translation?.summaryZh || post.text, 180)}\n   行业：${industries}\n   公司：${companies}\n   [原帖](${post.url})`;
  }).join('\n\n');
  return `## X Insight Monitor｜${date} 每日汇总\n> 新帖 ${posts.length}｜完成 ${completed.length}｜失败 ${failed.length}\n\n${rows || '今日暂无新帖'}${posts.length > 30 ? `\n\n> 另有 ${posts.length - 30} 条，请在桌面应用查看完整历史。` : ''}`;
}
