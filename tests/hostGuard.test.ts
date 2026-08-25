import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BlockedHostError, resolveSafeTarget } from '../app/lib/server/hostGuard.ts';

/** 拒否されることを確認する */
async function assertBlocked(host: string) {
  await assert.rejects(() => resolveSafeTarget(host), BlockedHostError, `${host} は拒否されるべきです`);
}

describe('resolveSafeTarget', () => {
  it('公開 IP は通す', async () => {
    assert.deepEqual(await resolveSafeTarget('8.8.8.8'), {
      address: '8.8.8.8', family: 4, hostname: '8.8.8.8',
    });
    assert.deepEqual(await resolveSafeTarget('3.143.243.81'), {
      address: '3.143.243.81', family: 4, hostname: '3.143.243.81',
    });
  });

  it('Host ヘッダ用に正規化済みのホスト名を返す', async () => {
    // 検査したのは正規化後の文字列なので、名乗る側もこれに揃える
    const target = await resolveSafeTarget('  8.8.8.8  ');
    assert.equal(target.hostname, '8.8.8.8');
  });

  it('ループバック・プライベート・リンクローカルを拒否する', async () => {
    await assertBlocked('127.0.0.1');
    await assertBlocked('10.1.2.3');
    await assertBlocked('192.168.1.1');
    await assertBlocked('172.16.0.1');
    await assertBlocked('169.254.169.254'); // クラウドのメタデータ
    await assertBlocked('0.0.0.0');
    await assertBlocked('100.64.0.1');
  });

  it('IPv6 のループバック・ユニークローカルを拒否する', async () => {
    await assertBlocked('::1');
    await assertBlocked('fd00::1');
    await assertBlocked('fe80::1');
  });

  it('IPv4 射影表記による迂回を許さない', async () => {
    await assertBlocked('::ffff:127.0.0.1');
    await assertBlocked('::ffff:169.254.169.254');
  });

  it('射影表記の公開 IP は素の IPv4 として通す', async () => {
    assert.deepEqual(await resolveSafeTarget('::ffff:8.8.8.8'), {
      address: '8.8.8.8', family: 4, hostname: '::ffff:8.8.8.8',
    });
  });

  it('空・過長なホスト名を拒否する', async () => {
    await assertBlocked('');
    await assertBlocked('   ');
    await assertBlocked(`${'a'.repeat(300)}.example.com`);
  });

  it('ホスト名に使えない文字を、名前解決を試みる前に拒否する', async () => {
    // Host ヘッダへそのまま載る値なので、改行や空白が混ざる余地を残さない
    const CRLF = String.fromCharCode(13, 10);
    await assertBlocked(`rtk2go.com${CRLF}X-Injected: 1`);
    await assertBlocked('rtk2go.com evil.com');
    await assertBlocked('rtk2go.com/../admin');
    await assertBlocked('http://rtk2go.com');
  });

  it('解決できないホスト名を拒否する', async () => {
    await assertBlocked('this-host-does-not-exist.invalid');
  });

  it('localhost を拒否する', async () => {
    await assertBlocked('localhost');
  });
});

describe('NTRIP_ALLOWED_HOSTS による明示的な許可リスト', () => {
  it('設定時はリスト外のホストを拒否する', async () => {
    const previous = process.env.NTRIP_ALLOWED_HOSTS;
    process.env.NTRIP_ALLOWED_HOSTS = 'rtk2go.com, example.org';
    try {
      await assertBlocked('8.8.8.8');
      await assertBlocked('other.example.com');
    } finally {
      if (previous === undefined) delete process.env.NTRIP_ALLOWED_HOSTS;
      else process.env.NTRIP_ALLOWED_HOSTS = previous;
    }
  });
});
