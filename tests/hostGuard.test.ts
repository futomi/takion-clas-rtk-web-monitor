import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BlockedHostError, isValidPort, resolveSafeTarget } from '../app/lib/server/hostGuard.ts';

/** 拒否されることを確認する */
async function assertBlocked(host: string) {
  await assert.rejects(() => resolveSafeTarget(host), BlockedHostError, `${host} は拒否されるべきです`);
}

describe('isValidPort', () => {
  it('1〜65535 の整数のみ受理する', () => {
    assert.equal(isValidPort(2101), true);
    assert.equal(isValidPort(1), true);
    assert.equal(isValidPort(65535), true);
    assert.equal(isValidPort(0), false);
    assert.equal(isValidPort(65536), false);
    assert.equal(isValidPort(-1), false);
    assert.equal(isValidPort(2101.5), false);
    assert.equal(isValidPort(Number.NaN), false);
  });
});

describe('resolveSafeTarget', () => {
  it('公開 IP は通す', async () => {
    assert.deepEqual(await resolveSafeTarget('8.8.8.8'), { address: '8.8.8.8', family: 4 });
    assert.deepEqual(await resolveSafeTarget('3.143.243.81'), { address: '3.143.243.81', family: 4 });
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
    assert.deepEqual(await resolveSafeTarget('::ffff:8.8.8.8'), { address: '8.8.8.8', family: 4 });
  });

  it('空・過長なホスト名を拒否する', async () => {
    await assertBlocked('');
    await assertBlocked('   ');
    await assertBlocked(`${'a'.repeat(300)}.example.com`);
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
