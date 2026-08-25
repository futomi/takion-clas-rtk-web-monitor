import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  acquireSourceTableSlot,
  acquireStreamSlot,
  activeSourceTableCount,
  activeStreamCount,
} from '../app/lib/server/streamLimit.ts';

/** 取得したスロットを必ず返し、テスト間で状態を持ち越さない */
const releases: (() => void)[] = [];

const track = (release: (() => void) | null) => {
  if (release) releases.push(release);
  return release;
};

const acquire = () => track(acquireStreamSlot());
const acquireSourceTable = () => track(acquireSourceTableSlot());

afterEach(() => {
  for (const release of releases.splice(0)) release();
  delete process.env.NTRIP_MAX_CONCURRENT_STREAMS;
  delete process.env.NTRIP_MAX_CONCURRENT_SOURCETABLES;
  assert.equal(activeStreamCount(), 0);
  assert.equal(activeSourceTableCount(), 0);
});

describe('acquireStreamSlot', () => {
  it('上限までは確保でき、超えた分は null を返す', () => {
    process.env.NTRIP_MAX_CONCURRENT_STREAMS = '2';
    assert.ok(acquire());
    assert.ok(acquire());
    assert.equal(acquire(), null);
    assert.equal(activeStreamCount(), 2);
  });

  it('解放すれば次の接続を受け付ける', () => {
    process.env.NTRIP_MAX_CONCURRENT_STREAMS = '1';
    const release = acquire();
    assert.ok(release);
    assert.equal(acquire(), null);

    release();
    assert.equal(activeStreamCount(), 0);
    assert.ok(acquire());
  });

  it('解放は何度呼んでもよい（後始末の経路が複数あるため）', () => {
    process.env.NTRIP_MAX_CONCURRENT_STREAMS = '2';
    const release = acquire();
    assert.ok(release);
    release();
    release();
    release();
    assert.equal(activeStreamCount(), 0);
  });

  it('不正な上限値は既定値へ落とす', () => {
    process.env.NTRIP_MAX_CONCURRENT_STREAMS = 'abc';
    assert.ok(acquire());
    process.env.NTRIP_MAX_CONCURRENT_STREAMS = '0';
    assert.ok(acquire());
    assert.equal(activeStreamCount(), 2);
  });
});

describe('acquireSourceTableSlot', () => {
  it('Source-table 取得にも上限がある', () => {
    process.env.NTRIP_MAX_CONCURRENT_SOURCETABLES = '2';
    assert.ok(acquireSourceTable());
    assert.ok(acquireSourceTable());
    assert.equal(acquireSourceTable(), null);
    assert.equal(activeSourceTableCount(), 2);
  });

  it('ストリーム中継とは枠が独立している', () => {
    // 長寿命の中継が埋まっていても、短時間で終わる局リスト取得は受け付けたい
    process.env.NTRIP_MAX_CONCURRENT_STREAMS = '1';
    process.env.NTRIP_MAX_CONCURRENT_SOURCETABLES = '1';

    assert.ok(acquire());
    assert.equal(acquire(), null);
    assert.ok(acquireSourceTable(), 'ストリームが埋まっていても取得できる');

    assert.equal(activeStreamCount(), 1);
    assert.equal(activeSourceTableCount(), 1);
  });
});
