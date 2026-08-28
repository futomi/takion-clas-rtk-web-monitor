import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  PLATFORM_MARKERS,
  isManagedPlatform,
  isNtripAvailable,
} from '../app/lib/server/ntripAvailability.ts';

/** Host ヘッダーだけを持つリクエストヘッダ */
const withHost = (host: string) => new Headers({ host });

afterEach(() => {
  delete process.env.NTRIP_ENABLED;
  for (const marker of PLATFORM_MARKERS) delete process.env[marker];
});

describe('isManagedPlatform', () => {
  it('目印がひとつも無ければ false', () => {
    assert.equal(isManagedPlatform(), false);
  });

  it('目印のいずれかが入っていれば true', () => {
    for (const marker of PLATFORM_MARKERS) {
      process.env[marker] = '1';
      assert.equal(isManagedPlatform(), true, marker);
      delete process.env[marker];
    }
  });

  it('空文字は設定されていないものとして扱う', () => {
    // PaaS 以外でも同名の変数が空で入っている場合に、誤って締め出さないため
    process.env.RENDER = '';
    assert.equal(isManagedPlatform(), false);
  });
});

describe('isNtripAvailable', () => {
  it('ローカルから開かれていれば受け付ける', () => {
    assert.equal(isNtripAvailable(withHost('localhost:3000')), true);
    assert.equal(isNtripAvailable(withHost('127.0.0.1:3000')), true);
    assert.equal(isNtripAvailable(withHost('[::1]:3000')), true);
  });

  it('外部のホスト名で開かれていれば断る', () => {
    assert.equal(isNtripAvailable(withHost('myapp.onrender.com')), false);
    assert.equal(isNtripAvailable(withHost('myapp.vercel.app')), false);
  });

  it('Host ヘッダーが無ければ断る', () => {
    assert.equal(isNtripAvailable(new Headers()), false);
  });

  it('既知の PaaS 上では Host を詐称されても断る', () => {
    process.env.VERCEL = '1';
    assert.equal(isNtripAvailable(withHost('localhost')), false);
    assert.equal(isNtripAvailable(withHost('127.0.0.1')), false);
  });

  it('NTRIP_ENABLED=true なら PaaS 上でも受け付ける', () => {
    // VPS などで意図して中継を立てる場合の逃げ道
    process.env.RENDER = 'true';
    process.env.NTRIP_ENABLED = 'true';
    assert.equal(isNtripAvailable(withHost('myapp.onrender.com')), true);
  });

  it('NTRIP_ENABLED は true 以外を有効と見なさない', () => {
    for (const value of ['1', 'yes', 'TRUE', '']) {
      process.env.NTRIP_ENABLED = value;
      assert.equal(isNtripAvailable(withHost('example.com')), false, value);
    }
  });
});
