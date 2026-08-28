import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  clearSourceTableCache,
  loadSourceTable,
  readSourceTableCache,
  sourceTableCacheSize,
} from '../app/lib/server/sourceTableCache.ts';

/** 中断しない依頼 */
const live = () => new AbortController().signal;

/** 呼ばれた回数を数えつつ、決まった本文を返す取得 */
function countingLoad(body: string) {
  const state = { calls: 0 };
  return {
    state,
    load: async () => {
      state.calls += 1;
      return body;
    },
  };
}

/**
 * 呼び出し側から結果を操れる取得。
 *
 * 中断が届いたら拒否するところまで真似る。実物（Caster への接続）も同じように振る舞うため、
 * ここを省くと「中断したのに取得が終わらない」という現実には無い状態を作ってしまう。
 */
function deferredLoad() {
  let resolveBody!: (body: string) => void;
  let rejectBody!: (error: unknown) => void;
  const state = { calls: 0, signal: null as AbortSignal | null };

  const load = (signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      state.calls += 1;
      state.signal = signal;
      resolveBody = resolve;
      rejectBody = reject;
      signal.addEventListener('abort', () => reject(new Error('上流を畳んだ')), { once: true });
    });

  return {
    load,
    state,
    settle: (body: string) => resolveBody(body),
    fail: (error: unknown) => rejectBody(error),
  };
}

afterEach(() => {
  clearSourceTableCache();
  delete process.env.NTRIP_SOURCETABLE_CACHE_SECONDS;
});

describe('loadSourceTable', () => {
  it('2 回目は控えから返し、Caster へは行かない', async () => {
    const { load, state } = countingLoad('{"count":1}');

    const first = await loadSourceTable('rtk2go.com:2101', load, live());
    assert.equal(first.body, '{"count":1}');
    assert.equal(first.fromCache, false);

    const second = await loadSourceTable('rtk2go.com:2101', load, live());
    assert.equal(second.body, '{"count":1}');
    assert.equal(second.fromCache, true);
    assert.equal(state.calls, 1);
  });

  it('宛先が違えば別々に控える', async () => {
    const { load, state } = countingLoad('{}');

    await loadSourceTable('rtk2go.com:2101', load, live());
    await loadSourceTable('rtk2go.com:2102', load, live());
    await loadSourceTable('ntrip.example.jp:2101', load, live());

    assert.equal(state.calls, 3);
    assert.equal(sourceTableCacheSize(), 3);
  });

  it('同じ宛先への取得が重なっても Caster へは 1 回しか行かない', async () => {
    const deferred = deferredLoad();

    const first = loadSourceTable('same:2101', deferred.load, live());
    const second = loadSourceTable('same:2101', deferred.load, live());
    assert.equal(deferred.state.calls, 1, '2 本目は相乗りする');

    deferred.settle('{"count":2}');
    assert.equal((await first).body, '{"count":2}');
    assert.equal((await second).body, '{"count":2}');
  });

  it('期限を過ぎたら取り直す', async (t) => {
    t.mock.timers.enable({ apis: ['Date'] });
    const { load, state } = countingLoad('{}');

    await loadSourceTable('expiring:2101', load, live());
    t.mock.timers.tick(600_000 + 1);

    const again = await loadSourceTable('expiring:2101', load, live());
    assert.equal(again.fromCache, false);
    assert.equal(state.calls, 2);
  });

  it('失敗は控えず、次の依頼でまた取りに行く', async () => {
    const failing = deferredLoad();
    const attempt = loadSourceTable('failing:2101', failing.load, live());
    failing.fail(new Error('Caster が応答しない'));
    await assert.rejects(attempt, /Caster が応答しない/);
    assert.equal(sourceTableCacheSize(), 0);

    const { load, state } = countingLoad('{}');
    await loadSourceTable('failing:2101', load, live());
    assert.equal(state.calls, 1);
  });

  it('待ち手が全員降りたら Caster への接続も畳む', async () => {
    const deferred = deferredLoad();
    const controller = new AbortController();

    const attempt = loadSourceTable('aborting:2101', deferred.load, controller.signal);
    controller.abort();

    await assert.rejects(attempt, /中断されました/);
    assert.equal(deferred.state.signal?.aborted, true);
    assert.equal(sourceTableCacheSize(), 0);
  });

  it('相乗りした依頼が 1 つ降りても、残りの取得は続く', async () => {
    const deferred = deferredLoad();
    const leaving = new AbortController();
    const staying = new AbortController();

    const abandoned = loadSourceTable('shared:2101', deferred.load, leaving.signal);
    const kept = loadSourceTable('shared:2101', deferred.load, staying.signal);

    leaving.abort();
    await assert.rejects(abandoned, /中断されました/);
    assert.equal(deferred.state.signal?.aborted, false, '残った依頼の取得は畳まない');

    deferred.settle('{"ok":true}');
    assert.equal((await kept).body, '{"ok":true}');
  });
});

describe('控えの上限', () => {
  it('抱える宛先の数には上限があり、古いものから落ちる', async () => {
    const { load } = countingLoad('{}');
    for (const key of ['a:1', 'b:1', 'c:1', 'd:1', 'e:1']) {
      await loadSourceTable(key, load, live());
    }

    assert.equal(sourceTableCacheSize(), 4);
    assert.equal(readSourceTableCache('a:1'), null, '最も古い宛先が落ちる');
    assert.equal(readSourceTableCache('e:1'), '{}');
  });

  it('NTRIP_SOURCETABLE_CACHE_SECONDS=0 なら控えない', async () => {
    process.env.NTRIP_SOURCETABLE_CACHE_SECONDS = '0';
    const { load, state } = countingLoad('{}');

    await loadSourceTable('nocache:2101', load, live());
    await loadSourceTable('nocache:2101', load, live());

    assert.equal(sourceTableCacheSize(), 0);
    assert.equal(state.calls, 2);
  });

  it('不正な期限は既定値へ落とす', async () => {
    process.env.NTRIP_SOURCETABLE_CACHE_SECONDS = 'abc';
    const { load, state } = countingLoad('{}');

    await loadSourceTable('fallback:2101', load, live());
    await loadSourceTable('fallback:2101', load, live());

    assert.equal(state.calls, 1);
  });
});
