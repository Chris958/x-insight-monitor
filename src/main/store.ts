import { app, safeStorage } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppData, AppLog, AppSettings, DEFAULT_SETTINGS, MonitorAccount, SecretSettings, StoredPost } from './types.js';

const EMPTY_SECRETS: SecretSettings = { openaiApiKey: '', wecomWebhookUrl: '', xCookieHeader: '', xAccountAlias: 'desktop-monitor' };

export class DataStore {
  private data!: AppData;
  private writeChain = Promise.resolve();
  readonly dataPath: string;
  readonly secretsPath: string;

  constructor(userDataPath = app.getPath('userData')) {
    this.dataPath = join(userDataPath, 'data.json');
    this.secretsPath = join(userDataPath, 'secrets.bin');
  }

  async init() {
    await mkdir(dirname(this.dataPath), { recursive: true });
    try { this.data = JSON.parse(await readFile(this.dataPath, 'utf8')) as AppData; }
    catch { this.data = { version: 1, settings: DEFAULT_SETTINGS, accounts: [], posts: [], logs: [], usage: {} }; await this.persist(); }
    this.data.settings = { ...DEFAULT_SETTINGS, ...this.data.settings };
  }

  snapshot(): AppData { return structuredClone(this.data); }
  getSettings(): AppSettings { return structuredClone(this.data.settings); }
  async saveSettings(value: Partial<AppSettings>) { this.data.settings = { ...this.data.settings, ...value }; await this.persist(); }

  async getSecrets(): Promise<SecretSettings> {
    try {
      const bytes = await readFile(this.secretsPath);
      if (!safeStorage.isEncryptionAvailable()) return EMPTY_SECRETS;
      return { ...EMPTY_SECRETS, ...JSON.parse(safeStorage.decryptString(bytes)) };
    } catch { return structuredClone(EMPTY_SECRETS); }
  }

  async saveSecrets(value: SecretSettings) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('操作系统安全存储当前不可用，无法保存敏感参数');
    await writeFile(this.secretsPath, safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 });
  }

  async addAccount(input: Pick<MonitorAccount, 'username'> & Partial<MonitorAccount>) {
    const username = input.username.replace(/^@/, '').trim();
    if (!username || !/^[A-Za-z0-9_]{1,15}$/.test(username)) throw new Error('X 用户名格式无效');
    if (this.data.accounts.some(a => a.username.toLowerCase() === username.toLowerCase())) throw new Error('该账号已存在');
    if (this.data.accounts.length >= this.data.settings.maxAccounts) throw new Error(`最多可添加 ${this.data.settings.maxAccounts} 个账号`);
    const account: MonitorAccount = { id: randomUUID(), username, displayName: input.displayName || '', enabled: true, includeReplies: input.includeReplies ?? false, includeReposts: input.includeReposts ?? false, includeQuotes: input.includeQuotes ?? true, intervalSec: input.intervalSec ?? this.data.settings.pollIntervalSec, consecutiveFailures: 0 };
    this.data.accounts.push(account); await this.persist(); return account;
  }

  async updateAccount(id: string, patch: Partial<MonitorAccount>) { const a = this.data.accounts.find(x => x.id === id); if (!a) throw new Error('账号不存在'); Object.assign(a, patch); await this.persist(); return a; }
  async deleteAccount(id: string) { this.data.accounts = this.data.accounts.filter(x => x.id !== id); await this.persist(); }
  getAccount(id: string) { return this.data.accounts.find(x => x.id === id); }

  getPostBySourceId(id: string) { return this.data.posts.find(p => p.postId === id); }
  async upsertPost(post: StoredPost) { const i = this.data.posts.findIndex(p => p.postId === post.postId); if (i >= 0) this.data.posts[i] = post; else this.data.posts.unshift(post); this.data.posts = this.data.posts.slice(0, 2000); await this.persist(); }
  async updatePost(id: string, patch: Partial<StoredPost>) { const p = this.data.posts.find(x => x.id === id); if (!p) throw new Error('帖子不存在'); Object.assign(p, patch); await this.persist(); return p; }
  getPost(id: string) { return this.data.posts.find(x => x.id === id); }

  async log(level: AppLog['level'], component: string, message: string) { this.data.logs.unshift({ id: randomUUID(), at: new Date().toISOString(), level, component, message }); this.data.logs = this.data.logs.slice(0, 500); await this.persist(); }
  getUsageToday() { return this.data.usage[new Date().toISOString().slice(0,10)] || 0; }
  async countModelCall() { const key = new Date().toISOString().slice(0,10); this.data.usage[key] = (this.data.usage[key] || 0) + 1; await this.persist(); }

  private async persist() {
    const payload = JSON.stringify(this.data, null, 2); const tmp = `${this.dataPath}.tmp`;
    this.writeChain = this.writeChain.then(async () => { await writeFile(tmp, payload, 'utf8'); await rename(tmp, this.dataPath); });
    await this.writeChain;
  }
}
