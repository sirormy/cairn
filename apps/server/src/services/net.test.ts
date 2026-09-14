import { describe, expect, it } from 'vitest';
import { isPrivateAddress, parseMetaRefresh } from './net.js';

describe('isPrivateAddress', () => {
  it('识别私网与回环 IPv4', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('10.1.2.3')).toBe(true);
    expect(isPrivateAddress('192.168.1.1')).toBe(true);
    expect(isPrivateAddress('172.16.0.1')).toBe(true);
    expect(isPrivateAddress('172.31.255.255')).toBe(true);
    expect(isPrivateAddress('169.254.1.1')).toBe(true); // 链路本地
    expect(isPrivateAddress('100.64.0.1')).toBe(true); // CGNAT
    expect(isPrivateAddress('0.0.0.0')).toBe(true);
    expect(isPrivateAddress('224.0.0.1')).toBe(true); // 组播
  });

  it('放行公网 IPv4', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('1.1.1.1')).toBe(false);
    expect(isPrivateAddress('172.32.0.1')).toBe(false); // 172.16/12 之外
    expect(isPrivateAddress('100.128.0.1')).toBe(false);
    // 198.18.0.0/15 是 Clash/Mihomo fake-ip 代理的 DNS 应答网段，
    // 拦截它会让代理机器上所有抓取失败，刻意放行
    expect(isPrivateAddress('198.18.4.100')).toBe(false);
    expect(isPrivateAddress('198.19.255.1')).toBe(false);
  });

  it('识别特殊 IPv6', () => {
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('::')).toBe(true);
    expect(isPrivateAddress('fe80::1')).toBe(true); // 链路本地
    expect(isPrivateAddress('fc00::1')).toBe(true); // ULA
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true); // v4 映射
    expect(isPrivateAddress('2606:4700::1111')).toBe(false);
  });
});

describe('parseMetaRefresh', () => {
  // t.co 现在返回的真实中转页（200，不再 301）
  const tcoInterstitial =
    '<head><noscript><META http-equiv="refresh" content="0;URL=https://x.com/i/article/1900000000000000002"></noscript><title>https://x.com/i/article/1900000000000000002</title></head><script>window.opener = null; location.replace("https:\\/\\/x.com\\/i\\/article\\/1900000000000000002")</script>';

  it('解析 t.co 中转页的 meta refresh 目标', () => {
    expect(parseMetaRefresh(tcoInterstitial)).toBe(
      'https://x.com/i/article/1900000000000000002',
    );
  });

  it('容忍属性顺序颠倒', () => {
    expect(
      parseMetaRefresh(
        '<meta content="0;URL=https://example.com/x" http-equiv="refresh">',
      ),
    ).toBe('https://example.com/x');
  });

  it('普通页面返回 null', () => {
    expect(parseMetaRefresh('<html><body>hello</body></html>')).toBeNull();
    expect(parseMetaRefresh('<meta http-equiv="content-type" content="text/html">')).toBeNull();
  });
});
