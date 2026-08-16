import { afterEach, describe, expect, it, vi } from 'vitest';
import { splitMarkdown, truncateUtf8, utf8Bytes, WeComAppClient } from './wecom.js';

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

describe('WeCom application messages', () => {
  it('sends Text to configured recipients and agent', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ errcode:0, access_token:'token', expires_in:7200 }), { status:200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errcode:0, errmsg:'ok' }), { status:200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new WeComAppClient({ corpId:'ww-test', agentId:'1000002', appSecret:'secret', recipients:'user1|user2' });
    await client.sendText('事实审查完成');
    const payload = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(payload).toMatchObject({ touser:'user1|user2', agentid:1000002, msgtype:'text', text:{ content:'事实审查完成' } });
  });

  it('uploads a thumbnail and sends MPNews', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ errcode:0, access_token:'token', expires_in:7200 }), { status:200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errcode:0, media_id:'media-1' }), { status:200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errcode:0, errmsg:'ok' }), { status:200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new WeComAppClient({ corpId:'ww-test', agentId:'1000002', appSecret:'secret', recipients:'user1' });
    await client.sendMpNews({ title:'报告', digest:'摘要', content:'<p>完整内容</p>', sourceUrl:'https://x.com/test' });
    const payload = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(payload.msgtype).toBe('mpnews');
    expect(payload.mpnews.articles[0]).toMatchObject({ title:'报告', thumb_media_id:'media-1', content:'<p>完整内容</p>' });
  });
});
