import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveActiveSource, resolveQualityDisplay } from '../app/lib/correctionSource.ts';
import type { ActiveSourceInput } from '../app/lib/correctionSource.ts';

const base: ActiveSourceInput = {
  mode: 'clas',
  quality: 0,
  isNtripActive: false,
  isL6Active: false,
  mountpoint: '',
};

const resolve = (overrides: Partial<ActiveSourceInput>) => resolveActiveSource({ ...base, ...overrides });

describe('resolveActiveSource', () => {
  it('未測位は「測位データ待ち」になる', () => {
    assert.deepEqual(resolve({ quality: 0 }), {
      type: 'none',
      badgeShort: '未測位',
      detail: '測位データ待ち',
      suffix: '',
    });
  });

  it('単独測位モードでは内部が Fix でも単独測位として表示する', () => {
    assert.equal(resolve({ mode: 'none', quality: 4 }).type, 'none');
    assert.equal(resolve({ mode: 'none', quality: 4 }).detail, '単独測位 (内部CLAS Fix)');
    assert.equal(resolve({ mode: 'none', quality: 5 }).detail, '単独測位 (内部CLAS Float)');
    assert.equal(resolve({ mode: 'none', quality: 1 }).detail, 'GNSS 単独測位');
  });

  it('高精度 Fix では NTRIP の生存を優先して判定する', () => {
    const ntrip = resolve({ quality: 4, isNtripActive: true, mountpoint: 'SAKURA' });
    assert.equal(ntrip.type, 'ntrip');
    assert.equal(ntrip.detail, 'RTK Fix完了 (SAKURA)');
    assert.equal(ntrip.suffix, ' (RTK)');

    const clas = resolve({ quality: 4, isNtripActive: false });
    assert.equal(clas.type, 'clas');
    assert.equal(clas.suffix, ' (CLAS)');
  });

  it('マウントポイント未指定なら既定ラベルを使う', () => {
    assert.match(resolve({ quality: 4, isNtripActive: true }).detail, /RTK2GO/);
  });

  it('高精度 Float は収束中として区別する', () => {
    assert.equal(resolve({ quality: 5, isNtripActive: true }).type, 'ntrip');
    assert.equal(resolve({ quality: 5 }).type, 'clas-converging');
  });

  it('単独測位中の CLAS は L6 受信の有無で文言を変える', () => {
    assert.equal(resolve({ mode: 'clas', quality: 1, isL6Active: true }).badgeShort, '🛰️ CLAS 収束中');
    assert.equal(resolve({ mode: 'clas', quality: 1, isL6Active: false }).badgeShort, '🛰️ CLAS 探索中');
    assert.equal(resolve({ mode: 'clas', quality: 1 }).suffix, ' (CLAS待機)');
  });

  it('単独測位中の NTRIP は接続状態で種別を切り替える', () => {
    const active = resolve({ mode: 'ntrip', quality: 1, isNtripActive: true });
    assert.equal(active.type, 'ntrip-converging');
    assert.equal(active.suffix, ' (RTK待機)');

    const idle = resolve({ mode: 'ntrip', quality: 1, isNtripActive: false });
    assert.equal(idle.type, 'none');
    assert.equal(idle.suffix, '');
    assert.equal(idle.detail, 'NTRIP未接続 (単独測位)');
  });
});

describe('resolveQualityDisplay', () => {
  it('既知の品質コードにラベルと配色を割り当てる', () => {
    assert.deepEqual(resolveQualityDisplay(0, ''), { label: '測位できていません', short: 'NO FIX', tone: 'none' });
    assert.deepEqual(resolveQualityDisplay(1, ''), { label: '単独測位 (3D FIX)', short: '3D FIX', tone: 'single' });
    assert.deepEqual(resolveQualityDisplay(2, ''), { label: 'DGPS測位', short: 'DGPS', tone: 'float' });
    assert.deepEqual(resolveQualityDisplay(6, ''), { label: '推測航法', short: 'DR', tone: 'single' });
  });

  it('高精度測位のときだけ補正ソースの接尾辞を添える', () => {
    assert.equal(resolveQualityDisplay(4, ' (RTK)').label, '高精度測位 Fix (RTK)');
    assert.equal(resolveQualityDisplay(5, ' (CLAS)').label, '高精度測位 Float (CLAS)');
    // 単独測位には接尾辞を付けない
    assert.equal(resolveQualityDisplay(1, ' (CLAS待機)').label, '単独測位 (3D FIX)');
  });

  it('未定義は 0 として扱い、未知のコードはそのまま表示する', () => {
    assert.equal(resolveQualityDisplay(undefined, '').short, 'NO FIX');
    assert.deepEqual(resolveQualityDisplay(3, ''), { label: '測位品質 3', short: 'Q3', tone: 'single' });
  });
});
