import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GGA_QUALITY } from '../app/lib/constants.ts';
import type { TrackPoint } from '../app/lib/track.ts';
import {
  buildTrackFileName,
  escapeXml,
  exportTrack,
  formatLocalTimestamp,
  formatTrackCsv,
  formatTrackGeoJson,
  formatTrackGpx,
  resolveIsoTime,
} from '../app/lib/trackExport.ts';

const BASE_LAT = 35.681236;
const BASE_LON = 139.767125;

function point(overrides: Partial<TrackPoint> & { at: number }): TrackPoint {
  return {
    latitude: BASE_LAT,
    longitude: BASE_LON,
    quality: GGA_QUALITY.PRECISE_FIX,
    ...overrides,
  };
}

describe('formatLocalTimestamp', () => {
  it('ローカル時刻を固定幅で描画する', () => {
    // 実行環境のタイムゾーンに依存するため、書式だけを確かめる
    assert.match(formatLocalTimestamp(Date.UTC(2026, 7, 27, 3, 4, 5)), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('resolveIsoTime', () => {
  it('受信機が日付まで申告していればそれを使う', () => {
    assert.equal(resolveIsoTime(point({ at: 0, utc: '2026-08-27T01:02:03Z' })), '2026-08-27T01:02:03Z');
  });

  it('時刻しか無ければ PC の受信時刻で代用する', () => {
    const at = Date.UTC(2026, 7, 27, 1, 2, 3);
    assert.equal(resolveIsoTime(point({ at, utc: '01:02:03' })), new Date(at).toISOString());
  });
});

describe('buildTrackFileName', () => {
  it('開始時刻と形式からファイル名を組み立てる', () => {
    assert.match(buildTrackFileName(Date.now(), 'gpx'), /^track_\d{8}_\d{6}\.gpx$/);
  });
});

describe('formatTrackCsv', () => {
  const csv = formatTrackCsv([
    point({ at: 1000, utc: '2026-08-27T00:00:01Z', altitude: 12.345, hdop: 0.7, satellitesUsed: 21 }),
    point({ at: 2000, quality: GGA_QUALITY.STANDALONE }),
  ]);
  const lines = csv.split('\r\n');

  it('Excel 向けに BOM を付ける', () => {
    assert.equal(csv.charCodeAt(0), 0xfeff);
  });

  it('見出し行と点数ぶんの行を出す', () => {
    assert.equal(lines[0], '﻿index,time_local,time_utc,latitude,longitude,altitude_m,'
      + 'quality,quality_label,satellites_used,hdop,horizontal_error_m,vertical_error_m,speed_kmh,course_deg');
    // 末尾の改行で最後の要素が空になる
    assert.equal(lines.length, 4);
    assert.equal(lines[3], '');
  });

  it('測位品質を画面と同じラベルで書き出す', () => {
    assert.ok(lines[1].includes(',FIX,'), lines[1]);
    assert.ok(lines[2].includes(',3D FIX,'), lines[2]);
  });

  it('未取得の項目は 0 で埋めず空欄にする', () => {
    const cells = lines[2].split(',');
    // altitude_m と satellites_used は与えていないので空
    assert.equal(cells[5], '');
    assert.equal(cells[8], '');
  });

  it('cm 級の座標を丸めずに残す', () => {
    assert.ok(lines[1].includes(BASE_LAT.toFixed(8)), lines[1]);
  });
});

describe('escapeXml', () => {
  it('XML で意味を持つ文字を実体参照へ置き換える', () => {
    assert.equal(escapeXml('a<b>&"c"'), 'a&lt;b&gt;&amp;&quot;c&quot;');
  });
});

describe('formatTrackGpx', () => {
  it('欠測ごとに trkseg を分ける', () => {
    const gpx = formatTrackGpx([
      point({ at: 0 }),
      point({ at: 1000 }),
      point({ at: 120_000 }),
      point({ at: 121_000 }),
    ], 'track');

    assert.equal(gpx.match(/<trkseg>/g)?.length, 2);
    assert.equal(gpx.match(/<trkpt /g)?.length, 4);
  });

  it('測位品質を GPX の語彙へ寄せる', () => {
    const gpx = formatTrackGpx([
      point({ at: 0, quality: GGA_QUALITY.PRECISE_FIX }),
      point({ at: 1000, quality: GGA_QUALITY.STANDALONE }),
    ], 'track');

    assert.ok(gpx.includes('<fix>dgps</fix>'), gpx);
    assert.ok(gpx.includes('<fix>3d</fix>'), gpx);
  });

  it('名前に含まれる特殊文字を落とさずエスケープする', () => {
    const gpx = formatTrackGpx([], 'a & b');
    assert.ok(gpx.includes('<name>a &amp; b</name>'), gpx);
    assert.ok(!gpx.includes('<trkseg>'), '点が無ければ区間も出ない');
  });

  it('取得できていない値の要素は書かない', () => {
    const gpx = formatTrackGpx([point({ at: 0 }), point({ at: 1000 })], 'track');
    assert.ok(!gpx.includes('<ele>'), gpx);
    assert.ok(!gpx.includes('<sat>'), gpx);
  });
});

describe('formatTrackGeoJson', () => {
  it('地図と同じ分割規則でラインを書き出す', () => {
    const parsed: unknown = JSON.parse(formatTrackGeoJson([
      point({ at: 0, quality: GGA_QUALITY.PRECISE_FIX }),
      point({ at: 1000, quality: GGA_QUALITY.PRECISE_FIX }),
      point({ at: 2000, quality: GGA_QUALITY.STANDALONE }),
      point({ at: 3000, quality: GGA_QUALITY.STANDALONE }),
    ]));
    const collection = parsed as { type: string; features: { properties: { tone: string } }[] };

    assert.equal(collection.type, 'FeatureCollection');
    assert.equal(collection.features.length, 2);
    assert.deepEqual(collection.features.map((feature) => feature.properties.tone), ['fix', 'single']);
  });

  it('点が無くても妥当な GeoJSON を返す', () => {
    const parsed: unknown = JSON.parse(formatTrackGeoJson([]));
    assert.deepEqual(parsed, { type: 'FeatureCollection', features: [] });
  });
});

describe('exportTrack', () => {
  it('形式ごとに拡張子と MIME タイプを揃える', () => {
    const startedAt = Date.now();
    assert.match(exportTrack([], 'csv', startedAt).fileName, /\.csv$/);
    assert.equal(exportTrack([], 'gpx', startedAt).mimeType, 'application/gpx+xml;charset=utf-8');
    assert.equal(exportTrack([], 'geojson', startedAt).mimeType, 'application/geo+json;charset=utf-8');
  });

  it('GPX の軌跡名にはファイル名から拡張子を落としたものを使う', () => {
    const exported = exportTrack([point({ at: 0 })], 'gpx', Date.now());
    assert.ok(exported.content.includes(`<name>${exported.fileName.replace('.gpx', '')}</name>`), exported.content);
  });
});
