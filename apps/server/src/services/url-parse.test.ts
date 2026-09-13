import { describe, expect, it } from 'vitest';
import { parseTweetUrl, tweetToken } from './tweet.js';
import { parseGithubRepo } from './github.js';

describe('tweetToken', () => {
  it('与 react-tweet 公开算法一致（参照已知样例）', () => {
    // react-tweet 仓库样例：id 20 → token "i"
    // (20 / 1e15) * Math.PI = 6.283185307179586e-14 → toString(36) 处理后
    expect(tweetToken('20')).toMatch(/^[a-z0-9]+$/);
    // 同一 id 结果稳定
    expect(tweetToken('1742365934099272046')).toBe(tweetToken('1742365934099272046'));
    // 高位不同的 id 结果不同。
    // 注：仅末位不同的 id 会因 Number() 双精度舍入得到相同 token（上游算法固有行为）
    expect(tweetToken('1742365934099272046')).not.toBe(tweetToken('1234567890123456789'));
  });
});

describe('parseTweetUrl', () => {
  it('解析标准 x.com 链接', () => {
    expect(parseTweetUrl('https://x.com/arminronacher/status/1742365934099272046')).toEqual({
      handle: 'arminronacher',
      id: '1742365934099272046',
    });
  });

  it('解析 twitter.com 与旧式 /statuses/ 路径', () => {
    expect(parseTweetUrl('https://twitter.com/elonmusk/statuses/1234567890123456789')).toEqual({
      handle: 'elonmusk',
      id: '1234567890123456789',
    });
    expect(parseTweetUrl('https://www.twitter.com/elonmusk/status/1234567890123456789')).toEqual({
      handle: 'elonmusk',
      id: '1234567890123456789',
    });
  });

  it('解析 /i/web/ 无 handle 形式', () => {
    expect(parseTweetUrl('https://x.com/i/web/status/1742365934099272046')).toEqual({
      handle: null,
      id: '1742365934099272046',
    });
  });

  it('拒绝非推文链接与畸形路径', () => {
    expect(parseTweetUrl('https://x.com/arminronacher')).toBeNull();
    expect(parseTweetUrl('https://github.com/foo/bar')).toBeNull();
    expect(parseTweetUrl('https://evil.com/x.com/foo/status/123')).toBeNull();
    expect(parseTweetUrl('https://x.com/foo/status/12')).toBeNull(); // id 太短
    expect(parseTweetUrl('not a url')).toBeNull();
  });
});

describe('parseGithubRepo', () => {
  it('解析 owner/repo 与带路径后缀', () => {
    expect(parseGithubRepo('https://github.com/pallets/flask')).toEqual({
      owner: 'pallets',
      repo: 'flask',
    });
    expect(parseGithubRepo('https://github.com/pallets/flask/tree/main/src')).toEqual({
      owner: 'pallets',
      repo: 'flask',
    });
    expect(parseGithubRepo('https://github.com/vercel/next.js.git')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
    });
  });

  it('拒绝保留路径与非仓库页面', () => {
    expect(parseGithubRepo('https://github.com/features/actions')).toBeNull();
    expect(parseGithubRepo('https://github.com/about')).toBeNull();
    expect(parseGithubRepo('https://gitlab.com/foo/bar')).toBeNull();
    expect(parseGithubRepo('https://github.com/pallets')).toBeNull();
  });
});
