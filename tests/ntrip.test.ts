import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSourceTable, rankMountpoints } from '../app/lib/ntrip.ts';
import { calculateDistanceKm } from '../app/lib/geo.ts';

const STR_TOKYO = 'STR;TOKYO_BASE;Tokyo;RTCM 3.2;1005(1),1077(1);2;GPS+GLO;SNIP;JPN;35.68;139.76;1;0;sNTRIP;none;N;N;9600;';
const STR_OSAKA = 'STR;OSAKA_BASE;Osaka;RTCM 3.2;1005(1),1077(1);2;GPS+GLO;SNIP;JPN;34.69;135.50;0;0;sNTRIP;none;B;Y;4800;';
const STR_NOGEO = 'STR;NOGEO;Unknown;RTCM 3.2;;2;GPS;SNIP;USA;;;0;0;sNTRIP;none;N;N;0;';

describe('parseSourceTable', () => {
  it('STR 行だけを拾い、CAS/NET/HTTP ヘッダを無視する', () => {
    const raw = [
      'SOURCETABLE 200 OK',
      'Server: NTRIP Caster',
      '',
      'CAS;rtk2go.com;2101;NTRIP;SNIP;0;JPN;35.0;139.0;0.0.0.0;0;http://rtk2go.com',
      'NET;SNIP;example;B;N;http://example.com;none;none;none',
      STR_TOKYO,
      STR_OSAKA,
      'ENDSOURCETABLE',
    ].join('\r\n');

    const records = parseSourceTable(raw);
    assert.equal(records.length, 2);
    assert.equal(records[0].mountpoint, 'TOKYO_BASE');
    assert.equal(records[0].country, 'JPN');
    assert.equal(records[0].format, 'RTCM 3.2');
    assert.equal(records[0].carrier, 2);
    assert.equal(records[0].nmea, true);
    assert.equal(records[0].bitrate, 9600);
    assert.equal(records[0].fee, false);
    assert.equal(records[1].nmea, false);
    assert.equal(records[1].fee, true);
    assert.equal(records[1].authentication, 'B');
  });

  it('座標欄が空なら null にする', () => {
    const [record] = parseSourceTable(STR_NOGEO);
    assert.equal(record.latitude, null);
    assert.equal(record.longitude, null);
  });

  it('列が足りない行とマウントポイント名が空の行は捨てる', () => {
    assert.equal(parseSourceTable('STR;SHORT;Too;Few').length, 0);
    assert.equal(parseSourceTable('STR;;Empty;RTCM 3.2;;2;GPS;NET;JPN;35;139;0;0;g;n;N;N;0;').length, 0);
  });

  it('LF のみの改行にも対応する', () => {
    assert.equal(parseSourceTable([STR_TOKYO, STR_OSAKA].join('\n')).length, 2);
  });

  it('空文字を渡しても落ちない', () => {
    assert.deepEqual(parseSourceTable(''), []);
  });
});

describe('rankMountpoints', () => {
  const records = parseSourceTable([STR_OSAKA, STR_NOGEO, STR_TOKYO].join('\r\n'));

  it('基準位置があれば近い順に並べ、座標不明は末尾へ送る', () => {
    // 東京駅付近を基準にすると TOKYO_BASE が最寄り
    const ranked = rankMountpoints(records, 35.681, 139.767);
    assert.deepEqual(ranked.map((r) => r.mountpoint), ['TOKYO_BASE', 'OSAKA_BASE', 'NOGEO']);
    assert.ok(ranked[0].distanceKm! < 5);
    assert.ok(ranked[1].distanceKm! > 300);
    assert.equal(ranked[2].distanceKm, null);
  });

  it('基準位置が無ければ JPN 優先のアルファベット順にする', () => {
    const ranked = rankMountpoints(records, null, null);
    assert.deepEqual(ranked.map((r) => r.mountpoint), ['OSAKA_BASE', 'TOKYO_BASE', 'NOGEO']);
    assert.ok(ranked.every((r) => r.distanceKm === null));
  });

  it('元の配列を破壊しない', () => {
    const original = records.map((r) => r.mountpoint);
    rankMountpoints(records, 35.681, 139.767);
    assert.deepEqual(records.map((r) => r.mountpoint), original);
  });
});

describe('calculateDistanceKm', () => {
  it('東京〜大阪をおおよそ 400km と算出する', () => {
    const distance = calculateDistanceKm(35.681, 139.767, 34.702, 135.496);
    assert.ok(distance > 390 && distance < 410, `got ${distance}`);
  });
  it('同一地点は 0 になる', () => {
    assert.equal(calculateDistanceKm(35, 139, 35, 139), 0);
  });
});
