import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderReportMarkdown, splitMarkdown, truncateUtf8, utf8Bytes, validateWeComWebhook, WeComWebhookClient } from './wecom.js';
import { StoredPost } from './types.js';

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

describe('concise investment report', () => {
  it('shows only the core review and beneficiaries', () => {
    const post = {
      username:'analyst', url:'https://x.com/analyst/status/1',
      translation:{summaryZh:'数据中心电力紧张将增加燃气发电需求',translatedText:'不应出现在精简报告中的完整翻译'},
      investmentReview:{
        coreViewpoint:'数据中心电力紧张将增加燃气发电需求', verdict:'部分可信',
        verification:'电力需求上升有依据，但项目落地节奏仍不确定。',
        beneficiaryIndustries:[{name:'燃气轮机',rationale:'新增调峰电源需求'}],
        beneficiaryCompanies:[{name:'GE Vernova',ticker:'GEV',market:'NYSE',rationale:'提供燃气轮机设备',confidence:'高'}],
        risks:['数据中心建设延期'],
        evidence:[{title:'Power demand report',url:'https://example.com/report',publisher:'example.com',snippet:'',grade:'B'}]
      }
    } as unknown as StoredPost;
    const report=renderReportMarkdown(post);
    expect(report).toContain('可能受益公司');
    expect(report).toContain('GE Vernova');
    expect(report).not.toContain('不应出现在精简报告中的完整翻译');
    expect(report.split('\n').length).toBeLessThan(35);
  });
});
