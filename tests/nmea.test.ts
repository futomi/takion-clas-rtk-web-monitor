import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checksumIsValid,
  decodeNmeaSentence,
  formatNmeaDate,
  formatNmeaTime,
  parseCoordinate,
  parseNmea,
  parseNumber,
} from '../app/lib/nmea.ts';
import { withChecksum } from './helpers.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('ascii');

describe('parseNumber', () => {
  it('空文字と非数値は undefined になる', () => {
    assert.equal(parseNumber(''), undefined);
    assert.equal(parseNumber(undefined), undefined);
    assert.equal(parseNumber('abc'), undefined);
  });
  it('有限数はそのまま解釈する', () => {
    assert.equal(parseNumber('12.5'), 12.5);
    assert.equal(parseNumber('-3'), -3);
  });
});

describe('parseCoordinate', () => {
  it('ddmm.mmmm を十進度へ変換する', () => {
    // 3541.1493 = 35度41.1493分 = 35.685822°
    assert.ok(Math.abs(parseCoordinate('3541.1493', 'N')! - 35.6858216) < 1e-6);
  });
  it('南緯・西経は符号を反転する', () => {
    assert.ok(parseCoordinate('3541.1493', 'S')! < 0);
    assert.ok(parseCoordinate('13946.4295', 'W')! < 0);
  });
  it('半球が無い場合は undefined', () => {
    assert.equal(parseCoordinate('3541.1493', undefined), undefined);
  });
});

describe('formatNmeaTime / formatNmeaDate', () => {
  it('hhmmss.ss を整形する', () => {
    assert.equal(formatNmeaTime('123519.50'), '12:35:19.50');
    assert.equal(formatNmeaTime('123519'), '12:35:19');
    assert.equal(formatNmeaTime('123'), undefined);
  });
  it('ddmmyy を 2 桁年の閾値 80 で振り分ける', () => {
    assert.equal(formatNmeaDate('230394'), '1994-03-23');
    assert.equal(formatNmeaDate('230324'), '2024-03-23');
    assert.equal(formatNmeaDate('2303'), undefined);
  });
});

describe('checksumIsValid', () => {
  it('正しいチェックサムを受理する', () => {
    assert.equal(checksumIsValid('$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47'), true);
  });
  it('壊れたチェックサムを拒否する', () => {
    assert.equal(checksumIsValid('$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*48'), false);
  });
  it('検証できない行は null', () => {
    assert.equal(checksumIsValid('GPGGA,123519'), null);
    assert.equal(checksumIsValid('$GPGGA,123519'), null);
  });
});

describe('decodeNmeaSentence', () => {
  it('妥当なセンテンスをデコードする', () => {
    const text = withChecksum('$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,');
    assert.equal(decodeNmeaSentence(encoder.encode(text), decoder), text);
  });
  it('非 ASCII バイトを含む場合は拒否する', () => {
    const bytes = encoder.encode(withChecksum('$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,'));
    bytes[5] = 0x00;
    assert.equal(decodeNmeaSentence(bytes, decoder), null);
  });
  it('短すぎる・形式外の入力を拒否する', () => {
    assert.equal(decodeNmeaSentence(encoder.encode('$GP*11'), decoder), null);
    assert.equal(decodeNmeaSentence(encoder.encode('hello world 12345'), decoder), null);
  });
});

describe('parseNmea', () => {
  it('GGA から位置・品質・衛星数を取り出す', () => {
    const parsed = parseNmea('$GPGGA,123519,4807.038,N,01131.000,E,4,08,0.9,545.4,M,46.9,M,,*40');
    assert.equal(parsed.type, 'GGA');
    assert.equal(parsed.update.quality, 4);
    assert.equal(parsed.update.satellitesUsed, 8);
    assert.equal(parsed.update.hdop, 0.9);
    assert.equal(parsed.update.altitude, 545.4);
    assert.ok(parsed.update.latitude! > 48 && parsed.update.latitude! < 48.2);
  });

  it('GGA の quality が 0 なら位置系フィールドを明示的に無効化する', () => {
    const parsed = parseNmea(withChecksum('$GPGGA,123519,4807.038,N,01131.000,E,0,00,,,M,,M,,'));
    assert.equal(parsed.update.quality, 0);
    assert.ok('latitude' in parsed.update);
    assert.equal(parsed.update.latitude, undefined);
    assert.equal(parsed.update.horizontalError, undefined);
    // HDOP は GGA 自身が載せる値なので、この電文の責任で消す
    assert.ok('hdop' in parsed.update);
    assert.equal(parsed.update.hdop, undefined);
  });

  it('GGA の未測位では他電文が持つ項目（PDOP・速度）に手を出さない', () => {
    const parsed = parseNmea(withChecksum('$GPGGA,123519,4807.038,N,01131.000,E,0,00,,,M,,M,,'));
    assert.equal('pdop' in parsed.update, false);
    assert.equal('speedKmh' in parsed.update, false);
  });

  it('RMC のノットを km/h へ換算する', () => {
    const parsed = parseNmea(withChecksum('$GPRMC,123519,A,4807.038,N,01131.000,E,10.0,084.4,230394,,'));
    assert.ok(Math.abs(parsed.update.speedKmh! - 18.52) < 1e-9);
    assert.equal(parsed.update.course, 84.4);
    assert.equal(parsed.update.dateUtc, '1994-03-23');
  });

  it('RMC が無効(V)なら座標を採用しない', () => {
    const parsed = parseNmea(withChecksum('$GPRMC,123519,V,4807.038,N,01131.000,E,,,230394,,'));
    assert.equal(parsed.update.latitude, undefined);
  });

  it('GSA から使用衛星 PRN と DOP を取り出す', () => {
    const parsed = parseNmea(withChecksum('$GPGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1,1'));
    assert.deepEqual(parsed.gsa?.prns, [4, 5, 9, 12, 24]);
    assert.equal(parsed.gsa?.talker, 'GP');
    assert.equal(parsed.gsa?.systemId, 1);
    assert.equal(parsed.update.pdop, 2.5);
    assert.equal(parsed.update.hdop, 1.3);
    assert.equal(parsed.update.vdop, 2.1);
  });

  it('GSV から PRN 群と可視総数を取り出す', () => {
    const parsed = parseNmea(withChecksum('$GPGSV,3,1,11,01,40,083,46,02,17,308,41,12,07,344,39,14,22,228,45'));
    assert.deepEqual(parsed.gsv?.prns, [1, 2, 12, 14]);
    assert.equal(parsed.gsv?.totalInView, 11);
    assert.equal(parsed.gsv?.talker, 'GP');
  });

  it('GST の緯度・経度シグマから水平誤差を合成する', () => {
    const parsed = parseNmea(withChecksum('$GPGST,123519,1.0,2.0,1.0,0.0,3.0,4.0,5.0'));
    assert.equal(parsed.update.horizontalError, 5); // hypot(3,4)
    assert.equal(parsed.update.verticalError, 5);
  });

  it('ZDA の年月日をゼロ埋めして整形する', () => {
    const parsed = parseNmea(withChecksum('$GPZDA,123519,5,3,2024,00,00'));
    assert.equal(parsed.update.dateUtc, '2024-03-05');
    assert.equal(parsed.update.timeUtc, '12:35:19');
  });

  it('$ で始まらない行は RAW 扱い', () => {
    const parsed = parseNmea('garbage');
    assert.equal(parsed.type, 'RAW');
    assert.equal(parsed.valid, null);
  });
});
