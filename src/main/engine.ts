import { randomUUID } from 'node:crypto';
import { CollectorClient } from './collector.js';
import { OfficialXClient } from './official-x.js';
import { DataStore } from './store.js';
import { AiClient } from './ai.js';
import { SearchClient } from './search.js';
import { StoredPost, XPost, RuntimeStatus, MonitorAccount, Evidence, SecretSettings, XSource } from './types.js';
import { renderFlash, renderReport, WeComClient } from './wecom.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const isNewer = (a: string, b?: string) => !b || BigInt(a) > BigInt(b);

export class MonitorEngine {
  private timer?: NodeJS.Timeout;
  private unofficialCollector = new CollectorClient();
  private collector?: { fetch(username: string, limit?: number, sinceId?: string): Promise<XPost[]> };
  private search = new SearchClient();
  private busy = new Set<string>();
  private status: RuntimeStatus = { running:false, collector:'unknown', configured:false, activeJobs:0 };
  constructor(private store: DataStore, private onChange: () => void) {}

  getStatus() { return { ...this.status, activeJobs:this.busy.size }; }

  async start() {
    if (this.status.running) return;
    const secrets = await this.store.getSecrets();
    if (!secrets.openaiApiKey || !secrets.wecomWebhookUrl || (!secrets.xOfficialBearerToken && !secrets.xCookieHeader)) throw new Error('请先配置 OpenAI API Key、企业微信 Webhook，以及 X 官方 Bearer Token 或 X Cookie');
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
  async testWeCom() { const secret=await this.store.getSecrets(); if(!secret.wecomWebhookUrl) throw new Error('请先填写企业微信 Webhook'); await new WeComClient(secret.wecomWebhookUrl).test(); }
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

  private schedule(delay = 10000) { if (!this.status.running) return; this.timer = setTimeout(() => void this.cycle().finally(() => this.schedule()), delay); }
  private async cycle() {
    this.status.lastCycleAt = new Date().toISOString();
    const now = Date.now(); const accounts = this.store.snapshot().accounts.filter(a => a.enabled && (!a.nextPollAt || new Date(a.nextPollAt).getTime() <= now));
    await Promise.allSettled(accounts.map(a => this.poll(a, false))); this.onChange();
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
    const settings=this.store.getSettings(), secrets=await this.store.getSecrets(), ai=new AiClient(settings.openaiBaseUrl,secrets.openaiApiKey), wecom=new WeComClient(secrets.wecomWebhookUrl);
    try {
      this.guardQuota(); await this.store.updatePost(post.id,{status:'TRANSLATING'});
      const translation=await this.retry(() => ai.translate(settings.translationModel,post.text),3); await this.store.countModelCall();
      await this.store.updatePost(post.id,{translation,status:'FLASH_READY'});
      await this.retry(() => wecom.send(renderFlash(this.store.getPost(post.id)!,settings.timezone)),5);
      await this.store.updatePost(post.id,{flashSentAt:new Date().toISOString(),status:'FLASH_SENT'});
      this.guardQuota(); await this.store.updatePost(post.id,{status:'ANALYZING'});
      const analysis=await this.retry(() => ai.analyze(settings.analysisModel,post.text,translation.translatedText),3); await this.store.countModelCall();
      await this.store.updatePost(post.id,{...analysis,status:'VERIFYING'});
      const claimResults=[];
      for (const claim of analysis.claims) {
        let evidence: Evidence[]=[]; if (claim.type==='FACT'||claim.type==='NUMERIC_FACT') { try { evidence=await this.search.search(claim.claim,5); } catch(error) { await this.store.log('warn','search',error instanceof Error?error.message:String(error)); } }
        this.guardQuota(); claimResults.push(await this.retry(() => ai.verify(settings.analysisModel,claim,evidence),2)); await this.store.countModelCall();
      }
      await this.store.updatePost(post.id,{claimResults,status:'REPORT_READY'});
      await this.retry(() => wecom.send(renderReport(this.store.getPost(post.id)!)),5);
      await this.store.updatePost(post.id,{reportSentAt:new Date().toISOString(),status:'REPORT_SENT'});
      await this.store.log('info','pipeline',`@${post.username} 帖子 ${post.postId} 已完成两阶段推送`);
    } catch(error) { const message=error instanceof Error?error.message:String(error); await this.store.updatePost(post.id,{status:'FAILED_FINAL',error:message}); await this.store.log('error','pipeline',`帖子 ${post.postId}: ${message}`); }
    this.onChange();
  }

  private guardQuota() { if(this.store.getUsageToday()>=this.store.getSettings().dailyModelLimit) throw new Error('已达到今日模型调用上限'); }
  private async retry<T>(fn:()=>Promise<T>, attempts:number) { let error:unknown; for(let i=0;i<attempts;i++){try{return await fn();}catch(e){error=e;if(i<attempts-1)await sleep(500*2**i+Math.random()*300);}}throw error; }
}
