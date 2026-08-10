import { XPost } from './types.js';

type XApiError = { detail?: string; title?: string; type?: string; value?: string };
type XUser = { id: string; username: string; name?: string };
type XMedia = { media_key: string; type: 'photo'|'video'|'animated_gif'; url?: string; preview_image_url?: string };
type XReference = { type: 'retweeted'|'quoted'|'replied_to'; id: string };
type XTweet = {
  id: string; text: string; created_at?: string; lang?: string;
  referenced_tweets?: XReference[];
  attachments?: { media_keys?: string[] };
  public_metrics?: { like_count?: number; reply_count?: number; retweet_count?: number; impression_count?: number };
  note_tweet?: { text?: string };
};
type XResponse<T> = { data?: T; includes?: { tweets?: XTweet[]; media?: XMedia[] }; errors?: XApiError[]; detail?: string; title?: string };

export type OfficialXHealth = { ok: boolean; source: 'official_x'; username: string };

export class OfficialXClient {
  private readonly baseUrl: string;
  private readonly userCache = new Map<string, XUser>();

  constructor(private readonly bearerToken: string, baseUrl = 'https://api.x.com/2') {
    if (!bearerToken.trim()) throw new Error('X 官方 API Bearer Token 不能为空');
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async health(username = 'XDevelopers'): Promise<OfficialXHealth> {
    const user = await this.lookupUser(username);
    return { ok: true, source: 'official_x', username: user.username };
  }

  async fetch(username: string, limit = 10, sinceId?: string): Promise<XPost[]> {
    const user = await this.lookupUser(username);
    const params = new URLSearchParams({
      max_results: String(Math.max(5, Math.min(limit, 100))),
      'tweet.fields': 'created_at,lang,public_metrics,referenced_tweets,attachments,note_tweet',
      expansions: 'referenced_tweets.id,attachments.media_keys',
      'media.fields': 'media_key,type,url,preview_image_url'
    });
    if (sinceId) params.set('since_id', sinceId);
    const response = await this.request<XResponse<XTweet[]>>(`/users/${encodeURIComponent(user.id)}/tweets?${params}`);
    const includedTweets = new Map((response.includes?.tweets || []).map(tweet => [tweet.id, tweet]));
    const media = new Map((response.includes?.media || []).map(item => [item.media_key, item]));
    return (response.data || []).map(tweet => this.normalize(tweet, user, includedTweets, media));
  }

  private async lookupUser(username: string): Promise<XUser> {
    const login = username.replace(/^@/, '').trim();
    const key = login.toLowerCase();
    const cached = this.userCache.get(key);
    if (cached) return cached;
    const response = await this.request<XResponse<XUser>>(`/users/by/username/${encodeURIComponent(login)}?user.fields=name,username`);
    if (!response.data) throw new Error(`X 官方 API 找不到账号 @${login}`);
    this.userCache.set(key, response.data);
    return response.data;
  }

  private async request<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${this.bearerToken}`, Accept: 'application/json' },
        signal: controller.signal
      });
      const body = await response.json().catch(() => ({})) as XResponse<unknown>;
      if (!response.ok) {
        const detail = body.detail || body.errors?.map(error => error.detail || error.title || error.value).filter(Boolean).join('；') || body.title;
        const reset = response.headers.get('x-rate-limit-reset');
        const retryAt = response.status === 429 && reset ? `，额度重置时间 ${new Date(Number(reset) * 1000).toLocaleString('zh-CN')}` : '';
        throw new Error(`X 官方 API 请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}${retryAt}`);
      }
      return body as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('X 官方 API 请求超时');
      throw error;
    } finally { clearTimeout(timer); }
  }

  private normalize(tweet: XTweet, user: XUser, includedTweets: Map<string, XTweet>, media: Map<string, XMedia>): XPost {
    const references = tweet.referenced_tweets || [];
    const repost = references.find(reference => reference.type === 'retweeted');
    const quote = references.find(reference => reference.type === 'quoted');
    const reply = references.find(reference => reference.type === 'replied_to');
    const postType = repost ? 'repost' : quote ? 'quote' : reply ? 'reply' : 'original';
    const attachments = (tweet.attachments?.media_keys || []).map(key => media.get(key)).filter((item): item is XMedia => Boolean(item)).map(item => ({
      type: item.type === 'photo' ? 'image' as const : item.type === 'animated_gif' ? 'gif' as const : 'video' as const,
      url: item.url || item.preview_image_url || ''
    })).filter(item => Boolean(item.url));
    const result: XPost = {
      source: 'official_x', postId: tweet.id, authorId: user.id, username: user.username,
      displayName: user.name || user.username, text: tweet.note_tweet?.text || tweet.text,
      language: tweet.lang, publishedAt: tweet.created_at || '', url: `https://x.com/${user.username}/status/${tweet.id}`,
      postType, media: attachments,
      metrics: { likes: tweet.public_metrics?.like_count, replies: tweet.public_metrics?.reply_count, reposts: tweet.public_metrics?.retweet_count, views: tweet.public_metrics?.impression_count }
    };
    if (quote) result.quotedPost = { postId: quote.id, url: `https://x.com/i/status/${quote.id}`, text: includedTweets.get(quote.id)?.note_tweet?.text || includedTweets.get(quote.id)?.text };
    if (reply) result.repliedToPost = { postId: reply.id, url: `https://x.com/i/status/${reply.id}` };
    return result;
  }
}
