import { describe, expect, it } from 'vitest';
import { splitMarkdown } from './wecom.js';

describe('splitMarkdown', () => {
  it('keeps short messages intact', () => expect(splitMarkdown('hello', 20)).toEqual(['hello']));
  it('splits long messages without losing content', () => {
    const source = '第一段内容\n\n第二段内容很长\n\n第三段';
    const chunks = splitMarkdown(source, 12);
    expect(chunks.every(x => x.length <= 12)).toBe(true);
    expect(chunks.join('\n\n').replace(/\n\n\n\n/g, '\n\n')).toContain('第一段内容');
    expect(chunks.join('')).toContain('第二段内容很长');
  });
});
