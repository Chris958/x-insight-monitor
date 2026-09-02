import { afterEach, describe, expect, it, vi } from 'vitest';
import { splitMarkdown, truncateUtf8, utf8Bytes, validateWeComWebhook, WeComWebhookClient } from './wecom.js';

afterEach(() => vi.unstubAllGlobals());

describe('UTF-8 message limits', () => {
  it('keeps short messages intact', () => expect(splitMarkdown('hello', 20)).toEqual(['hello']));

  it('splits Chinese and emoji by bytes without losing text', () => {
    const source = '第一段内容\n\n第二段😆内容很长\n\n第三段';
    const chunks = splitMarkdown(source, 12);
    expect(chunks.every(chunk => utf8Bytes(chunk) <= 12)).toBe(true);
    expect(chunks.join('').replace(/\s/g, '')).toBe(source.replace(/\s/g, ''));
  });

  it('truncates without breaking unicode characters', () => {
    const output = truncateUtf8('中文😆📈abcdef', 12);
    expect(utf8Bytes(output)).toBeLessThanOrEqual(12);
    expect(output.endsWith('…')).toBe(true);
  });
});

describe('WeCom webhook messages', () => {
  const webhook = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=00000000-0000-0000-0000-000000000000';

  it('rejects non-WeCom webhook URLs', () => {
    expect(() => validateWeComWebhook('https://example.com/hook?key=test')).toThrow('完整 Webhook');
    expect(() => validateWeComWebhook('not-a-url')).toThrow('格式无效');
  });

  it('sends markdown through the configured group robot', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ errcode:0, errmsg:'ok' }), { status:200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new WeComWebhookClient(webhook).sendMarkdown('## 事实审查完成');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(webhook);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ msgtype:'markdown', markdown:{ content:'## 事实审查完成' } });
  });

  it('reports Enterprise WeChat API errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ errcode:93000, errmsg:'invalid webhook url' }), { status:200 })));
    await expect(new WeComWebhookClient(webhook).sendMarkdown('test')).rejects.toThrow('invalid webhook url');
  });
});
