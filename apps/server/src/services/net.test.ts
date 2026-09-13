import { describe, expect, it } from 'vitest';
import { isPrivateAddress } from './net.js';

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
