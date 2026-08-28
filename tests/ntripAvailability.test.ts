import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isNtripAvailable } from '../app/lib/server/ntripAvailability.ts';

/** Host ヘッダーだけを持つリクエストヘッダ */
const withHost = (host: string) => new Headers({ host });

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

  it('中継を開ける環境変数は用意していない', () => {
    // ローカル実行だけを想定しているため、外から有効化する手段は持たせない
    for (const name of ['NTRIP_ENABLED', 'NTRIP_ALLOW_REMOTE']) {
      process.env[name] = 'true';
      assert.equal(isNtripAvailable(withHost('myapp.example.com')), false, name);
      delete process.env[name];
    }
  });
});
