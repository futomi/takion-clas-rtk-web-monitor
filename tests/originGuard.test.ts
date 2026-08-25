import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ForbiddenOriginError, assertSameOrigin } from '../app/lib/server/originGuard.ts';

const headers = (entries: Record<string, string>) => new Headers(entries);

describe('assertSameOrigin', () => {
  it('自分のページからの呼び出しは通す', () => {
    assert.doesNotThrow(() => assertSameOrigin(headers({
      'sec-fetch-site': 'same-origin',
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
    })));
  });

  it('URL 直打ちなど利用者自身の操作（Sec-Fetch-Site: none）も通す', () => {
    assert.doesNotThrow(() => assertSameOrigin(headers({ 'sec-fetch-site': 'none', host: 'localhost:3000' })));
  });

  it('外部サイトからの呼び出しを拒否する', () => {
    assert.throws(
      () => assertSameOrigin(headers({
        'sec-fetch-site': 'cross-site',
        origin: 'https://evil.example',
        host: 'monitor.example.jp',
      })),
      ForbiddenOriginError,
    );
  });

  it('別サブドメインからの呼び出しも拒否する', () => {
    // 同一サイトでも別オリジンである以上、このアプリのページからの呼び出しではない
    assert.throws(
      () => assertSameOrigin(headers({ 'sec-fetch-site': 'same-site' })),
      ForbiddenOriginError,
    );
  });

  it('Sec-Fetch-Site が無くても Origin が食い違えば拒否する', () => {
    assert.throws(
      () => assertSameOrigin(headers({ origin: 'https://evil.example', host: 'monitor.example.jp' })),
      ForbiddenOriginError,
    );
  });

  it('Sec-Fetch-Site が無く Origin が一致すれば通す', () => {
    assert.doesNotThrow(
      () => assertSameOrigin(headers({ origin: 'https://monitor.example.jp', host: 'monitor.example.jp' })),
    );
  });

  it('スキームが違っても、ホストが一致すれば通す', () => {
    // 前段のプロキシで TLS を終端する構成では、Origin だけが https になる
    assert.doesNotThrow(
      () => assertSameOrigin(headers({ origin: 'https://monitor.example.jp', host: 'monitor.example.jp' })),
    );
  });

  it('出所不明を表す Origin: null を拒否する', () => {
    assert.throws(
      () => assertSameOrigin(headers({ origin: 'null', host: 'monitor.example.jp' })),
      ForbiddenOriginError,
    );
  });

  it('Host が無ければ Origin と突き合わせられないので拒否する', () => {
    assert.throws(
      () => assertSameOrigin(headers({ origin: 'https://monitor.example.jp' })),
      ForbiddenOriginError,
    );
  });

  it('判断材料が一切無ければ通す（ブラウザ以外のクライアント）', () => {
    // ヘッダを詐称できる相手にこの検査は効かない。ここは CORS の穴埋めに徹する
    assert.doesNotThrow(() => assertSameOrigin(headers({})));
  });
});
