import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractHostname, isLoopbackHost, isLoopbackHostname } from '../app/lib/localHost.ts';

describe('extractHostname', () => {
  it('ポートを落とす', () => {
    assert.equal(extractHostname('localhost:3000'), 'localhost');
    assert.equal(extractHostname('example.com:8443'), 'example.com');
  });

  it('ポートが無ければそのまま返す', () => {
    assert.equal(extractHostname('example.com'), 'example.com');
  });

  it('IPv6 リテラルは括弧ごと 1 つのホスト名として扱う', () => {
    assert.equal(extractHostname('[::1]:3000'), '[::1]');
    assert.equal(extractHostname('[::1]'), '[::1]');
  });

  it('大文字と前後の空白を均す', () => {
    assert.equal(extractHostname('  LocalHost:3000  '), 'localhost');
  });
});

describe('isLoopbackHostname', () => {
  it('localhost とそのサブドメインを通す', () => {
    assert.equal(isLoopbackHostname('localhost'), true);
    assert.equal(isLoopbackHostname('app.localhost'), true);
  });

  it('127.0.0.0/8 を通す', () => {
    assert.equal(isLoopbackHostname('127.0.0.1'), true);
    assert.equal(isLoopbackHostname('127.1.2.3'), true);
  });

  it('IPv6 のループバックを通す', () => {
    assert.equal(isLoopbackHostname('::1'), true);
    assert.equal(isLoopbackHostname('[::1]'), true);
  });

  it('外部のホスト名は通さない', () => {
    assert.equal(isLoopbackHostname('example.com'), false);
    assert.equal(isLoopbackHostname('myapp.onrender.com'), false);
    assert.equal(isLoopbackHostname('myapp.vercel.app'), false);
  });

  it('ループバックに似せた名前は通さない', () => {
    // 名前の一部に含むだけ、末尾がドット区切りでない、ドメインを後ろへ足した、の 3 通り
    assert.equal(isLoopbackHostname('notlocalhost'), false);
    assert.equal(isLoopbackHostname('evil-localhost'), false);
    assert.equal(isLoopbackHostname('localhost.example.com'), false);
  });

  it('ループバックに似せた IP は通さない', () => {
    assert.equal(isLoopbackHostname('128.0.0.1'), false);
    assert.equal(isLoopbackHostname('127.0.0.1.example.com'), false);
    // 8 進表記で 127.0.0.1 を指す書き方。数値へ寄せて解釈しないことを確かめる
    assert.equal(isLoopbackHostname('0177.0.0.1'), false);
  });

  it('外側の IPv6 は通さない', () => {
    assert.equal(isLoopbackHostname('[::2]'), false);
    assert.equal(isLoopbackHostname('[2001:db8::1]'), false);
  });
});

describe('isLoopbackHost', () => {
  it('ポート付きでも判定できる', () => {
    assert.equal(isLoopbackHost('localhost:3000'), true);
    assert.equal(isLoopbackHost('[::1]:3000'), true);
    assert.equal(isLoopbackHost('myapp.vercel.app:443'), false);
  });

  it('空文字は通さない', () => {
    assert.equal(isLoopbackHost(''), false);
  });
});
