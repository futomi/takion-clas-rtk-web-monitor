import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GGA_QUALITY } from '../app/lib/constants.ts';
import type { TrackPoint } from '../app/lib/track.ts';
import { formatTrackCsv, formatTrackGeoJson, formatTrackGpx } from '../app/lib/trackExport.ts';
import {
  detectTrackFormat,
  importTrack,
  parseLocalTimestamp,
  parseTrackCsv,
  parseTrackGeoJson,
  parseTrackGpx,
  splitCsvLine,
} from '../app/lib/trackImport.ts';

const START = Date.UTC(2026, 7, 27, 1, 0, 0);

/** 書き出し → 読み込みの往復に使う 4 点。3 点目から Float に落ちる */
const POINTS: TrackPoint[] = [
  {
    at: START,
    utc: '2026-08-27T01:00:00Z',
    latitude: 35.681236,
    longitude: 139.767125,
    altitude: 40.123,
    quality: GGA_QUALITY.PRECISE_FIX,
    satellitesUsed: 21,
    hdop: 0.7,
    horizontalError: 0.014,
    verticalError: 0.02,
    speedKmh: 0.5,
    course: 90,
  },
  { at: START + 1000, utc: '2026-08-27T01:00:01Z', latitude: 35.681237, longitude: 139.767126, altitude: 40.1, quality: GGA_QUALITY.PRECISE_FIX },
  { at: START + 2000, utc: '2026-08-27T01:00:02Z', latitude: 35.681238, longitude: 139.767127, altitude: 40.2, quality: GGA_QUALITY.PRECISE_FLOAT },
  { at: START + 3000, utc: '2026-08-27T01:00:03Z', latitude: 35.681239, longitude: 139.767128, altitude: 40.3, quality: GGA_QUALITY.PRECISE_FLOAT },
];

describe('splitCsvLine', () => {
  it('引用符の中の区切りと二重引用符を扱う', () => {
    assert.deepEqual(splitCsvLine('a,"b,c","d""e",'), ['a', 'b,c', 'd"e', '']);
  });
});

describe('parseLocalTimestamp', () => {
  it('書き出しの time_local をローカル時刻として戻す', () => {
    assert.equal(parseLocalTimestamp('2026-08-27 10:00:05'), new Date(2026, 7, 27, 10, 0, 5).getTime());
    assert.equal(parseLocalTimestamp('2026/08/27'), undefined);
  });
});

describe('parseTrackCsv', () => {
  it('書き出した CSV を点に戻す', () => {
    const points = parseTrackCsv(formatTrackCsv(POINTS));
    assert.equal(points.length, POINTS.length);

    const [first] = points;
    assert.equal(first.at, START);
    assert.equal(first.utc, '2026-08-27T01:00:00Z');
    assert.equal(first.latitude, 35.681236);
    assert.equal(first.longitude, 139.767125);
    assert.equal(first.altitude, 40.123);
    assert.equal(first.quality, GGA_QUALITY.PRECISE_FIX);
    assert.equal(first.satellitesUsed, 21);
    assert.equal(first.hdop, 0.7);
    assert.equal(first.horizontalError, 0.014);
    assert.equal(first.verticalError, 0.02);
    assert.equal(first.speedKmh, 0.5);
    assert.equal(first.course, 90);

    assert.equal(points[2].quality, GGA_QUALITY.PRECISE_FLOAT);
    assert.deepEqual(points.map((point) => point.at - START), [0, 1000, 2000, 3000]);
  });

  it('受信機の UTC が無ければ PC のローカル時刻で歩みを決める', () => {
    const csv = [
      'index,time_local,latitude,longitude',
      '1,2026-08-27 10:00:00,35.1,139.1',
      '2,2026-08-27 10:00:05,35.2,139.2',
    ].join('\r\n');
    const points = parseTrackCsv(csv);
    assert.equal(points.length, 2);
    assert.equal(points[1].at - points[0].at, 5000);
    assert.equal(points[0].utc, undefined);
  });

  it('品質コードが無ければラベルから戻し、座標を欠く行は飛ばす', () => {
    const csv = [
      'latitude,longitude,quality_label',
      '35.1,139.1,FLOAT',
      ',,FIX',
      '35.2,139.2,FIX',
    ].join('\n');
    const points = parseTrackCsv(csv);
    assert.deepEqual(points.map((point) => point.quality), [GGA_QUALITY.PRECISE_FLOAT, GGA_QUALITY.PRECISE_FIX]);
  });
});

describe('parseTrackGpx', () => {
  it('書き出した GPX を点に戻す', () => {
    const points = parseTrackGpx(formatTrackGpx(POINTS, 'track'));
    assert.equal(points.length, POINTS.length);

    const [first] = points;
    assert.equal(first.at, START);
    assert.equal(first.latitude, 35.681236);
    assert.equal(first.longitude, 139.767125);
    assert.equal(first.altitude, 40.123);
    assert.equal(first.quality, GGA_QUALITY.PRECISE_FIX);
    assert.equal(first.satellitesUsed, 21);
    assert.equal(first.hdop, 0.7);
    assert.equal(points[3].quality, GGA_QUALITY.PRECISE_FLOAT);
  });

  it('属性の並びが違っても読める', () => {
    const gpx = '<gpx><trk><trkseg><trkpt lon="139.1" lat="35.1"><ele>1.5</ele></trkpt></trkseg></trk></gpx>';
    const [point] = parseTrackGpx(gpx);
    assert.equal(point.latitude, 35.1);
    assert.equal(point.longitude, 139.1);
    assert.equal(point.altitude, 1.5);
  });
});

describe('parseTrackGeoJson', () => {
  it('ラインの点を開始から終了まで等間隔に並べ、境目の重複は積まない', () => {
    const points = parseTrackGeoJson(formatTrackGeoJson(POINTS));
    // 品質が変わる 3 点目でラインが切れ、その点は前後のラインが共有している
    assert.equal(points.length, POINTS.length);
    assert.deepEqual(points.map((point) => point.at - START), [0, 1000, 2000, 3000]);
    assert.deepEqual(points.map((point) => point.latitude), POINTS.map((point) => point.latitude));
    assert.equal(points[0].altitude, undefined);
  });

  it('JSON として壊れていれば空', () => {
    assert.deepEqual(parseTrackGeoJson('{'), []);
  });
});

describe('detectTrackFormat', () => {
  it('中身の先頭で形式を見分ける', () => {
    assert.equal(detectTrackFormat(formatTrackCsv(POINTS)), 'csv');
    assert.equal(detectTrackFormat(formatTrackGpx(POINTS, 'track')), 'gpx');
    assert.equal(detectTrackFormat(formatTrackGeoJson(POINTS)), 'geojson');
    assert.equal(detectTrackFormat('<html></html>'), null);
    assert.equal(detectTrackFormat('hello'), null);
  });
});

describe('importTrack', () => {
  it('読める形式なら形式と点を返す', () => {
    const imported = importTrack(formatTrackCsv(POINTS));
    assert.equal(imported.format, 'csv');
    assert.equal(imported.points.length, POINTS.length);
  });

  it('形式が分からなければ利用者向けの文言で失敗する', () => {
    assert.throws(() => importTrack('hello'), /読み込めません/);
  });

  it('点が 1 つも無ければ失敗する', () => {
    assert.throws(() => importTrack('index,latitude,longitude\n'), /見つかりません/);
  });
});
