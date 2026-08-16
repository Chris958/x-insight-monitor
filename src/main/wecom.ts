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

async function parseResponse(res: Response, label: string) {
  const body = await res.json() as Record<string, any>;
  if (!res.ok || body.errcode !== 0) throw new Error(`${label}: ${body.errmsg || res.status}`);
  return body;
}

export class WeComWebhookClient {
  constructor(private webhook: string) {}

  async sendMarkdown(text: string) {
    const chunks = splitMarkdown(text);
    for (let i = 0; i < chunks.length; i++) {
      const prefix = chunks.length > 1 ? `**(${i + 1}/${chunks.length})**\n` : '';
      const res = await fetch(this.webhook, {
        method: 'POST', headers: { 'content-type':'application/json' },
        body: JSON.stringify({ msgtype:'markdown', markdown:{ content:prefix + chunks[i] } })
      });
      await parseResponse(res, '企业微信群汇总推送失败');
    }
  }

  async test() { await this.sendMarkdown('**X Insight Monitor**\n每日汇总通道测试成功。实时帖子不会通过此机器人发送。'); }
}

export interface WeComAppConfig { corpId: string; agentId: string; appSecret: string; recipients: string; }
export interface MpNewsArticle { title: string; digest: string; content: string; sourceUrl: string; }

// MPNews 必须提供 thumb_media_id。内置 PNG 只作兼容封面，避免用户手动维护素材 ID。
const COVER_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAIAAABqhmJGAAABk0lEQVR42u3TAQkAAAzDsOm4zou+jOsYBKKg0MweUCoSgIEBAwMGBgMDBgYMDBgYDAwYGDAwGBgwMGBgwMBgYMDAgIEBA4OBAQMDBgYDAwYGDAwYGAwMGBgwMGBgMDBgYMDAYGDAwICBAQODgQEDAwYGA6sABgYMDBgYDAwYGDAwYGAwMGBgwMBgYMDAgIEBA4OBAQMDBgYMDAYGDAwYGAwMGBgwMGBgMDBgYMDAgIHBwICBAQODgQEDAwYGDAwGBgwMGBgMDBgYMDBgYDAwYGDAwICBwcCAgQEDg4EBAwMGBgwMBgYMDBgYMDAYGDAwYGAwMGBgwMCAgcHAgIEBAwMGBgMDBgYMDAYGDAwYGDAwGBgwMGBgMDBgYMDAgIHBwICBAQMDBgYDAwYGDAwGBgwMGBgwMBgYMDBgYMDAYGDAwICBwcCAgQEDAwYGAwMGBgwMBlYBDAwYGDAwGBgwMGBgwMBgYMDAgIHBwICBAQMDBgYDAwYGDAwYGAwMGBgwMBgYMDBgYMDAYGDAwICBAQNDtwctKck5DTOqhAAAAABJRU5ErkJggg==', 'base64');

export class WeComAppClient {
  private token?: { value: string; expiresAt: number };
  private cover?: { mediaId: string; expiresAt: number };

  constructor(private config: WeComAppConfig) {}

  async sendText(content: string) {
    await this.sendPayload({
      touser:this.config.recipients, msgtype:'text', agentid:Number(this.config.agentId),
      text:{ content:truncateUtf8(content, 1950) }, safe:0,
      enable_duplicate_check:1, duplicate_check_interval:600
    });
  }

  async sendMpNews(article: MpNewsArticle) {
    const thumbMediaId = await this.getCoverMediaId();
    await this.sendPayload({
      touser:this.config.recipients, msgtype:'mpnews', agentid:Number(this.config.agentId),
      mpnews:{ articles:[{
        title:truncateUtf8(article.title, 120), thumb_media_id:thumbMediaId,
        author:'X Insight Monitor', content_source_url:article.sourceUrl,
        content:truncateUtf8(article.content, 650_000, ''),
        digest:truncateUtf8(article.digest, 480)
      }] },
      safe:0, enable_duplicate_check:1, duplicate_check_interval:600
    });
  }

  async test() {
    await this.sendText('【X Insight Monitor】个人微信 Text 通道测试成功。');
    await this.sendMpNews({
      title:'X Insight Monitor｜MPNews 测试成功',
      digest:'微信内完整图文通道已经连接。',
      content:'<h2>连接成功</h2><p>后续事实审查报告将通过此图文消息发送，企业微信群机器人只保留每日汇总。</p>',
      sourceUrl:'https://x.com'
    });
  }

  private async getAccessToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(this.config.corpId)}&corpsecret=${encodeURIComponent(this.config.appSecret)}`;
    const res = await fetch(url);
    const body = await parseResponse(res, '企业微信应用鉴权失败');
    this.token = { value:body.access_token, expiresAt:Date.now() + Math.max(300, Number(body.expires_in || 7200) - 300) * 1000 };
    return this.token.value;
  }

  private async sendPayload(payload: Record<string, unknown>, retried = false): Promise<void> {
    const token = await this.getAccessToken(retried);
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`, {
      method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(payload)
    });
    const body = await res.json() as Record<string, any>;
    if (!retried && [40014, 42001].includes(Number(body.errcode))) {
      this.token = undefined;
      return this.sendPayload(payload, true);
    }
    if (!res.ok || body.errcode !== 0) throw new Error(`企业微信应用推送失败: ${body.errmsg || res.status}`);
  }

  private async getCoverMediaId(): Promise<string> {
    if (this.cover && this.cover.expiresAt > Date.now()) return this.cover.mediaId;
    const token = await this.getAccessToken();
    const form = new FormData();
    form.append('media', new Blob([COVER_PNG], { type:'image/png' }), 'x-insight-cover.png');
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${encodeURIComponent(token)}&type=image`, { method:'POST', body:form });
    const body = await res.json() as Record<string, any>;
    if (!res.ok || body.errcode !== 0 || !body.media_id) throw new Error(`企业微信图文封面上传失败: ${body.errmsg || res.status}`);
    this.cover = { mediaId:body.media_id, expiresAt:Date.now() + 2.5 * 24 * 60 * 60 * 1000 };
    return body.media_id;
  }
}

const html = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
const list = (items?: string[]) => items?.length ? `<ul>${items.map(item => `<li>${html(item)}</li>`).join('')}</ul>` : '<p>无</p>';

export function renderRealtimeText(post: StoredPost, timezone: string) {
  const time = new Intl.DateTimeFormat('zh-CN', { dateStyle:'medium', timeStyle:'medium', timeZone:timezone }).format(new Date(post.publishedAt));
  return truncateUtf8(`【X监控快讯】@${post.username}\n时间：${time}\n\n${post.translation?.summaryZh || '已发现新帖子'}\n\n${post.translation?.translatedText || ''}\n\n事实核查进行中：${post.url}`, 1900);
}

function renderClaimHtml(post: StoredPost, result: ClaimResult, index: number) {
  const claim = post.claims?.find(item => item.id === result.claimId);
  const sources = result.evidence.length
    ? `<ul>${result.evidence.map(source => `<li><a href="${html(source.url)}">${html(source.title)}</a>（${html(source.publisher)}）</li>`).join('')}</ul>`
    : '<p>无可用外部来源</p>';
  return `<h3>${index + 1}. ${html(claim?.claim || '')}</h3><p><strong>结论：</strong>${html(result.verdict)}　<strong>证据充分度：</strong>${html(result.confidence)}</p><p>${html(result.rationale)}</p>${sources}`;
}

export function renderMpNews(post: StoredPost): MpNewsArticle {
  const claims = (post.claimResults || []).map((result, index) => renderClaimHtml(post, result, index)).join('');
  const content = `<h2>中文摘要</h2><p>${html(post.translation?.summaryZh)}</p><h2>中文翻译</h2><p>${html(post.translation?.translatedText).replace(/\n/g, '<br>')}</p><h2>总体判断</h2><p><strong>${html(post.overallResult || '请查看分项结论')}</strong></p><h2>观点与逻辑</h2><p>${html(post.logic?.conclusion || '无实质观点')}</p><h3>逻辑风险</h3>${list(post.logic?.reasoningGaps)}<h3>替代解释</h3>${list(post.logic?.alternativeExplanations)}<h2>事实核查</h2>${claims || '<p>没有需要核查的事实主张</p>'}<h2>局限</h2>${list(post.limitations)}<p><a href="${html(post.url)}">查看X原帖</a></p>`;
  return {
    title:`@${post.username} 事实审查｜${post.overallResult || '分析完成'}`,
    digest:`${post.translation?.summaryZh || ''}｜${post.overallResult || '查看完整报告'}`,
    content, sourceUrl:post.url
  };
}

export function renderDailySummary(posts: StoredPost[], date: string) {
  const completed = posts.filter(post => post.status === 'REPORT_COMPLETE' || post.status === 'REPORT_SENT');
  const failed = posts.filter(post => post.status === 'FAILED_FINAL');
  const rows = posts.slice(0, 30).map((post, index) => `${index + 1}. **@${post.username}**｜${post.overallResult || post.status}\n   ${truncateUtf8(post.translation?.summaryZh || post.text, 240)}\n   [原帖](${post.url})`).join('\n\n');
  return `## X Insight Monitor｜${date} 每日汇总\n> 新帖 ${posts.length}｜完成 ${completed.length}｜失败 ${failed.length}\n\n${rows || '今日暂无新帖'}${posts.length > 30 ? `\n\n> 另有 ${posts.length - 30} 条，请在桌面应用查看完整历史。` : ''}`;
}
