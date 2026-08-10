import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { app } from 'electron';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { XPost } from './types.js';

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

export class CollectorClient {
  private proc?: ChildProcessWithoutNullStreams;
  private pending = new Map<string, Pending>();
  private buffer = '';
  private dbPath = join(tmpdir(), `x-insight-${process.pid}-${randomUUID()}.db`);

  async start(cookieHeader: string, alias: string) {
    if (this.proc) { await this.call('configure', { cookieHeader, alias }); return; }
    const packaged = join(process.resourcesPath, 'collector', process.platform === 'win32' ? 'collector.exe' : 'collector');
    const script = join(app.getAppPath(), 'collector', 'collector.py');
    const command = app.isPackaged && existsSync(packaged) ? packaged : (process.platform === 'win32' ? 'python' : 'python3');
    const args = app.isPackaged && existsSync(packaged) ? ['--db', this.dbPath] : [script, '--db', this.dbPath];
    this.proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, TWS_TELEMETRY: '0', PYTHONUNBUFFERED: '1' } });
    this.proc.stdout.on('data', b => this.onData(b.toString()));
    this.proc.stderr.on('data', b => process.stderr.write(`[collector] ${b}`));
    this.proc.once('exit', () => { this.proc = undefined; for (const p of this.pending.values()) p.reject(new Error('采集进程已退出')); this.pending.clear(); });
    try { await this.call('configure', { cookieHeader, alias }); }
    catch (error) { await this.stop(); throw error; }
  }

  async health() { return this.call<{ ok: boolean; accounts: number }>('health', {}); }
  async fetch(username: string, limit = 10): Promise<XPost[]> { return this.call<XPost[]>('fetch', { username, limit }); }

  async stop() {
    if (this.proc) { try { await this.call('shutdown', {}, 3000); } catch { this.proc.kill(); } this.proc = undefined; }
    await unlink(this.dbPath).catch(() => undefined);
  }

  private call<T>(action: string, payload: object, timeoutMs = 45000): Promise<T> {
    if (!this.proc) return Promise.reject(new Error('采集进程未启动'));
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`采集请求超时: ${action}`)); }, timeoutMs);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.proc!.stdin.write(`${JSON.stringify({ id, action, payload })}\n`);
    });
  }

  private onData(text: string) {
    this.buffer += text;
    for (;;) {
      const nl = this.buffer.indexOf('\n'); if (nl < 0) break;
      const line = this.buffer.slice(0, nl); this.buffer = this.buffer.slice(nl + 1);
      try { const msg = JSON.parse(line); const p = this.pending.get(msg.id); if (!p) continue; clearTimeout(p.timer); this.pending.delete(msg.id); msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error || '采集失败')); } catch { /* ignore non-protocol output */ }
    }
  }
}
