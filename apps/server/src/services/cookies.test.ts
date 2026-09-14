import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { loadXCredentials, parseCookieFile } from './cookies.js';

const savedCookieFile = config.xCookieFile;
const savedAuthToken = config.xAuthToken;
const savedCt0 = config.xCt0;

afterEach(() => {
  config.xCookieFile = savedCookieFile;
  config.xAuthToken = savedAuthToken;
  config.xCt0 = savedCt0;
});

describe('parseCookieFile', () => {
  it('解析 EditThisCookie JSON 数组，只保留 X 关键 cookie', () => {
    const text = JSON.stringify([
      { name: 'auth_token', value: 'at123', domain: '.x.com' },
      { name: 'ct0', value: 'ct456', domain: '.x.com' },
      { name: 'twid', value: 'u%3D1', domain: '.x.com' },
      { name: '__cf_bm', value: 'noise', domain: '.x.com' },
      { name: 'some_other', value: 'noise2', domain: '.example.com' },
    ]);
    const cred = parseCookieFile(text);
    expect(cred.authToken).toBe('at123');
    expect(cred.ct0).toBe('ct456');
    // 无关 cookie 被剔除
    expect(cred.cookieHeader).not.toContain('__cf_bm');
    expect(cred.cookieHeader).toContain('auth_token=at123');
    expect(cred.cookieHeader).toContain('ct0=ct456');
  });

  it('解析 Netscape cookies.txt 格式（含 #HttpOnly_ 前缀行）', () => {
    const text = [
      '# Netscape HTTP Cookie File',
      '#HttpOnly_.x.com\tTRUE\t/\tTRUE\t1999999999\tauth_token\tat789',
      '.x.com\tTRUE\t/\tTRUE\t1999999999\tct0\tct012',
    ].join('\n');
    const cred = parseCookieFile(text);
    // HttpOnly 行不能因为以 # 开头被当成注释丢掉
    expect(cred.authToken).toBe('at789');
    expect(cred.ct0).toBe('ct012');
  });

  it('缺 auth_token / ct0 时报错', () => {
    expect(() => parseCookieFile(JSON.stringify([{ name: 'guest_id', value: 'x' }]))).toThrow(
      /auth_token 或 ct0/,
    );
  });
});

describe('loadXCredentials', () => {
  it('文件存在优先于 .env 配置', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cookies-'));
    try {
      const file = path.join(dir, 'x.cookie.json');
      writeFileSync(
        file,
        JSON.stringify([{ name: 'auth_token', value: 'from-file' }, { name: 'ct0', value: 'ct-file' }]),
      );
      config.xCookieFile = file;
      const cred = loadXCredentials();
      expect(cred?.authToken).toBe('from-file');
      expect(cred?.cookieHeader).toContain('auth_token=from-file');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('文件不存在且未配置 env 时返回 null；仅 .env 配置时可用', () => {
    config.xCookieFile = path.join(tmpdir(), 'definitely-missing-cookie.json');
    expect(loadXCredentials()).toBeNull();

    config.xAuthToken = 'env-token';
    config.xCt0 = 'env-ct0';
    const cred = loadXCredentials();
    expect(cred?.authToken).toBe('env-token');
    expect(cred?.cookieHeader).toBe('auth_token=env-token; ct0=env-ct0');
  });
});
