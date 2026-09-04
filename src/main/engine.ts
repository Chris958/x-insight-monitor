import { randomUUID } from 'node:crypto';
import { CollectorClient } from './collector.js';
import { OfficialXClient } from './official-x.js';
import { DataStore } from './store.js';
import { AiClient } from './ai.js';
import { SearchClient } from './search.js';
import { StoredPost, XPost, RuntimeStatus, MonitorAccount, Evidence, SecretSettings, XSource } from './types.js';
import { renderDailySummary, renderRealtimeText, renderReportMarkdown, WeComWebhookClient } from './wecom.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const isNewer = (a: string, b?: string) => !b || BigInt(a) > BigInt(b);
const localClock = (date: Date, timezone: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone:timezone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(date).map(part => [part.type, part.value]));
  return { date:`${parts.year}-${parts.month}-${parts.day}`, minutes:Number(parts.hour) * 60 + Number(parts.minute) };
};

export class MonitorEngine {
  private timer?: NodeJS.Timeout;
  private unofficialCollector = new CollectorClient();
  private collector?: { fetch(username: string, limit?: number, sinceId?: string): Promise<XPost[]> };
  private search = new SearchClient();
  private wecomWebhook?: WeComWebhookClient;
  private busy = new Set<string>();
  private status: RuntimeStatus = { running:false, collector:'unknown', configured:false, activeJobs:0 };
  constructor(private store: DataStore, private onChange: () => void) {}

  getStatus() { return { ...this.status, activeJobs:this.busy.size }; }

  async start() {
    if (this.status.running) return;
    const secrets = await this.store.getSecrets();
    const settings = this.store.getSettings();
    if (!secrets.openaiApiKey || (!secrets.xOfficialBearerToken && !secrets.xCookieHeader)) throw new Error('请先配置 OpenAI API Key，以及 X 官方 Bearer Token 或 X Cookie');
    this.configurePush(settings, secrets);
    const source = await this.configureCollector(secrets);
    this.status = { ...this.status, running:true, collector:'healthy', configured:true, activeSource:source };
    await this.store.log('info','engine',`监控服务已启动，当前渠道：${source === 'official_x' ? 'X 官方 API' : 'twscrape 非官方源'}`); this.schedule(500); this.onChange();
  }

  async stop() {
    this.status.running = false; if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    await this.unofficialCollector.stop(); this.collector=undefined; this.status.collector = 'unknown'; this.status.activeSource=undefined; await this.store.log('info','engine','监控服务已停止'); this.onChange();
  }

  async pollNow(accountId: string) { const account = this.store.getAccount(accountId); if (!account) throw new Error('账号不存在'); if (!this.status.running) await this.start(); await this.poll(account, true); }

  async testModel() { const s=this.store.getSettings(), secret=await this.store.getSecrets(); if(!secret.openaiApiKey) throw new Error('请先填写 API Key'); return new AiClient(s.openaiBaseUrl,secret.openaiApiKey).test(s.translationModel); }
  async testWeComWebhook() {
    const secret=await this.store.getSecrets();
    if(!secret.wecomWebhookUrl) throw new Error('请先填写企业微信群机器人 Webhook');
    await new WeComWebhookClient(secret.wecomWebhookUrl).test();
  }
  async testCollector() {
    const secret=await this.store.getSecrets();
    if(!secret.xOfficialBearerToken&&!secret.xCookieHeader) throw new Error('请先填写 X 官方 Bearer Token 或 X Cookie');
    const wasRunning=this.status.running;
    const source=await this.configureCollector(secret);
    if(!wasRunning&&source==='twscrape') await this.unofficialCollector.stop();
    if(!wasRunning) this.collector=undefined;
    return {ok:true,source};
  }

  private async configureCollector(secret: SecretSettings): Promise<XSource> {
    const testUsername=this.store.snapshot().accounts.find(account=>account.enabled)?.username || 'XDevelopers';
    if(secret.xOfficialBearerToken){
      await this.unofficialCollector.stop();
      const official=new OfficialXClient(secret.xOfficialBearerToken);
      await official.health(testUsername);
      this.collector=official;
      return 'official_x';
    }
    await this.unofficialCollector.start(secret.xCookieHeader,secret.xAccountAlias);
    const health=await this.unofficialCollector.health();
    if(!health.ok) throw new Error('X Cookie 采集凭据不可用');
    this.collector=this.unofficialCollector;
    return 'twscrape';
  }

  private configurePush(settings: ReturnType<DataStore['getSettings']>, secret: SecretSettings) {
    const enabled = settings.realtimeWebhookEnabled || settings.groupDailySummaryEnabled;
    if (enabled && !secret.wecomWebhookUrl) throw new Error('已开启企业微信机器人推送，请填写 Webhook');
    this.wecomWebhook = enabled ? new WeComWebhookClient(secret.wecomWebhookUrl) : undefined;
  }

  private schedule(delay = 10000) { if (!this.status.running) return; this.timer = setTimeout(() => void this.cycle().finally(() => this.schedule()), delay); }
  private async cycle() {
    this.status.lastCycleAt = new Date().toISOString();
    const now = Date.now(); const accounts = this.store.snapshot().accounts.filter(a => a.enabled && (!a.nextPollAt || new Date(a.nextPollAt).getTime() <= now));
    await Promise.allSettled(accounts.map(a => this.poll(a, false)));
    await this.maybeSendDailySummary();
    this.onChange();
  }

  private async poll(account: MonitorAccount, manual: boolean) {
    if (this.busy.has(account.id)) return; this.busy.add(account.id); this.onChange();
    try {
      if(!this.collector) throw new Error('X 采集器尚未初始化');
      const posts = await this.collector.fetch(account.username, 10, account.lastSeenPostId);
      const accepted = posts.filter(p => this.accept(account,p));
      if (!account.lastSeenPostId) {
        const newest = accepted.sort((a,b) => Number(BigInt(b.postId)-BigInt(a.postId)))[0];
        if (newest) await this.store.updateAccount(account.id,{lastSeenPostId:newest.postId,lastSuccessAt:new Date().toISOString(),consecutiveFailures:0,error:undefined,nextPollAt:this.nextPoll(account)});
        await this.store.log('info','collector',`@${account.username} 已建立基线，未推送历史帖子`);
        return;
      }
      const fresh = accepted.filter(p => isNewer(p.postId, account.lastSeenPostId)).sort((a,b) => a.postId < b.postId ? -1 : 1);
      for (const post of fresh) if (!this.store.getPostBySourceId(post.postId)) await this.process(post);
      const newest = accepted.reduce((id,p) => isNewer(p.postId,id) ? p.postId : id, account.lastSeenPostId);
      await this.store.updateAccount(account.id,{lastSeenPostId:newest,lastSuccessAt:new Date().toISOString(),consecutiveFailures:0,error:undefined,nextPollAt:this.nextPoll(account)});
      if (manual) await this.store.log('info','collector',`@${account.username} 手动抓取完成，新增 ${fresh.length} 条`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error); const failures=(account.consecutiveFailures||0)+1;
      await this.store.updateAccount(account.id,{consecutiveFailures:failures,error:message,nextPollAt:this.nextPoll(account,failures)});
      await this.store.log('error','collector',`@${account.username}: ${message}`); this.status.collector='error';
    } finally { this.busy.delete(account.id); this.onChange(); }
  }

  private accept(account: MonitorAccount, post: XPost) { return post.postType === 'original' || (post.postType === 'quote' && account.includeQuotes) || (post.postType === 'reply' && account.includeReplies) || (post.postType === 'repost' && account.includeReposts); }
  private nextPoll(account: MonitorAccount, failures=0) { const jitter=Math.floor(Math.random()*15-7); const backoff=Math.min(8,Math.max(1,2**Math.min(failures,3))); return new Date(Date.now()+(account.intervalSec+jitter)*1000*backoff).toISOString(); }

  private async process(source: XPost) {
    const post: StoredPost = { ...source, id:randomUUID(), discoveredAt:new Date().toISOString(), status:'DISCOVERED' };
    await this.store.upsertPost(post); this.onChange();
    const settings=this.store.getSettings(), secrets=await this.store.getSecrets(), ai=new AiClient(settings.openaiBaseUrl,secrets.openaiApiKey);
    try {
      this.guardQuota(); await this.store.updatePost(post.id,{status:'TRANSLATING'});
      const translation=await this.retry(() => ai.translate(settings.translationModel,post.text),3); await this.store.countModelCall();
      await this.store.updatePost(post.id,{translation,status:'FLASH_READY'});
      if (settings.realtimeWebhookEnabled && this.wecomWebhook) {
        try { await this.retry(() => this.wecomWebhook!.sendMarkdown(renderRealtimeText(this.store.getPost(post.id)!,settings.timezone)),3); await this.store.updatePost(post.id,{flashSentAt:new Date().toISOString()}); }
        catch(error) { await this.recordPushError(post.id, '机器人实时快讯推送', error); }
      }
      await this.store.updatePost(post.id,{status:'FLASH_SENT'});
      await this.store.updatePost(post.id,{status:'SEARCHING'});
      const searchResults = await Promise.allSettled((translation.searchQueries?.length ? translation.searchQueries : [translation.summaryZh]).slice(0,2).map(query => this.search.search(query,4)));
      const evidence: Evidence[]=[]; const seenUrls=new Set<string>();
      for (const result of searchResults) {
        if (result.status === 'rejected') { await this.store.log('warn','search',result.reason instanceof Error?result.reason.message:String(result.reason)); continue; }
        for (const item of result.value) if (!seenUrls.has(item.url)) { seenUrls.add(item.url); evidence.push(item); }
      }
      this.guardQuota(); await this.store.updatePost(post.id,{status:'REVIEWING'});
      const investmentReview=await this.retry(() => ai.reviewInvestment(settings.analysisModel,translation,evidence.slice(0,8)),3); await this.store.countModelCall();
      await this.store.updatePost(post.id,{investmentReview,status:'REPORT_READY'});
      if (settings.realtimeWebhookEnabled && this.wecomWebhook) {
        try { await this.retry(() => this.wecomWebhook!.sendMarkdown(renderReportMarkdown(this.store.getPost(post.id)!)),3); await this.store.updatePost(post.id,{reportSentAt:new Date().toISOString()}); }
        catch(error) { await this.recordPushError(post.id, '机器人完整报告推送', error); }
      }
      await this.store.updatePost(post.id,{status:'REPORT_COMPLETE'});
      await this.store.log('info','pipeline',`@${post.username} 帖子 ${post.postId} 已完成分析并保存完整历史`);
    } catch(error) { const message=error instanceof Error?error.message:String(error); await this.store.updatePost(post.id,{status:'FAILED_FINAL',error:message}); await this.store.log('error','pipeline',`帖子 ${post.postId}: ${message}`); }
    this.onChange();
  }

  private async recordPushError(postId: string, stage: string, error: unknown) {
    const message=error instanceof Error ? error.message : String(error);
    const post=this.store.getPost(postId);
    await this.store.updatePost(postId,{pushErrors:[...(post?.pushErrors || []),`${stage}: ${message}`]});
    await this.store.log('warn','push',`帖子 ${post?.postId || postId} ${stage}失败：${message}`);
  }

  private async maybeSendDailySummary() {
    const settings=this.store.getSettings();
    if (!settings.groupDailySummaryEnabled || !this.wecomWebhook) return;
    const clock=localClock(new Date(), settings.timezone);
    const [hour,minute]=settings.dailySummaryTime.split(':').map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || clock.minutes < hour * 60 + minute || this.store.hasDailySummary(clock.date)) return;
    const posts=this.store.snapshot().posts.filter(post => localClock(new Date(post.discoveredAt), settings.timezone).date === clock.date);
    if (!posts.length) return;
    try {
      await this.retry(() => this.wecomWebhook!.sendMarkdown(renderDailySummary(posts, clock.date)),3);
      await this.store.markDailySummary(clock.date);
      await this.store.log('info','push',`${clock.date} 企业微信群每日汇总已发送，共 ${posts.length} 条`);
    } catch(error) {
      await this.store.log('warn','push',`每日群汇总发送失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private guardQuota() { if(this.store.getUsageToday()>=this.store.getSettings().dailyModelLimit) throw new Error('已达到今日模型调用上限'); }
  private async retry<T>(fn:()=>Promise<T>, attempts:number) { let error:unknown; for(let i=0;i<attempts;i++){try{return await fn();}catch(e){error=e;if(i<attempts-1)await sleep(500*2**i+Math.random()*300);}}throw error; }
}
