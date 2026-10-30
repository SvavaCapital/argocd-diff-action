import { describe, expect, test } from '@jest/globals';

import { fitSections, truncateForSummary } from '../src/comment.js';

const section = (name: string, size: number) => ({ appName: name, body: `\nApp: ${name}\n${'x'.repeat(size)}\n` });

describe('fitSections', () => {
  test('keeps everything when it fits', () => {
    const s = [section('a', 100), section('b', 100)];
    expect(fitSections(s, 10_000, 'https://run')).toStrictEqual([s[0]!.body, s[1]!.body]);
  });

  test('replaces sections that do not fit and stays within budget', () => {
    const s = [section('a', 500), section('big', 50_000), section('c', 500)];
    const budget = 5_000;
    const out = fitSections(s, budget, 'https://run');
    expect(out[0]).toBe(s[0]!.body);
    expect(out[1]).toContain('`big`: diff omitted');
    expect(out[1]).toContain('https://run');
    expect(out[2]).toBe(s[2]!.body);
    expect(out.join('').length).toBeLessThanOrEqual(budget);
  });

  test('omits everything when even small sections do not fit', () => {
    const s = [section('a', 5_000), section('b', 5_000)];
    const out = fitSections(s, 300, 'https://run');
    expect(out.every(l => l.includes('diff omitted'))).toBe(true);
  });
});

describe('truncateForSummary', () => {
  test('leaves short text alone', () => {
    expect(truncateForSummary('abc', 10)).toBe('abc');
  });

  test('truncates long text to the limit with a note', () => {
    const out = truncateForSummary('x'.repeat(5_000), 1_000);
    expect(out.length).toBeLessThanOrEqual(1_000);
    expect(out).toContain('Output truncated');
  });
});
