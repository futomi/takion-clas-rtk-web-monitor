import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseNmea } from '../app/lib/nmea.ts';

/**
 * 要約テキストは `parseNmea` が分解したフィールドから組み立てられるため、
 * 実際に画面へ出るのと同じ経路（parseNmea の戻り値）で検証する。
 */
const summaryOf = (line: string) => parseNmea(line).summary;

describe('NMEA 要約テキスト', () => {
  it('GGA の測位品質と主要値を並べる', () => {
    const summary = summaryOf('$GPGGA,123519,4807.038,N,01131.000,E,4,08,0.9,545.4,M,46.9,M,,*40');
    assert.equal(summary, '高精度Fix · 08機 · HDOP 0.9 · 標高 545.4m');
  });

  it('RMC の対地速度をノットから km/h へ換算する', () => {
    // 10.0 ノット = 18.52 km/h
    assert.equal(summaryOf('$GPRMC,123519,A,4807.038,N,01131.000,E,10.0,84.4,230394,,*00'),
      '状態: 有効 · 18.5 km/h · 方位 84.4°');
  });

  it('GSV の系統名を GNSS_SYSTEMS の表記に統一する', () => {
    assert.match(summaryOf('$GPGSV,3,1,11,01,40,083,46*7A') ?? '', /^GPS 可視 11機/);
    assert.match(summaryOf('$GQGSV,1,1,02,194,60,180,45*7A') ?? '', /^みちびき 可視 02機/);
    assert.match(summaryOf('$GLGSV,1,1,06,70,40,083,46*7A') ?? '', /^GLONASS 可視 06機/);
  });

  it('値が欠けている電文は要約を持たない（辞書の既定説明にフォールバックさせる）', () => {
    assert.equal(summaryOf('$GPGST,123519,,,,,,,*4A'), undefined);
    assert.equal(summaryOf('$GPVTG,,T,,M,,N,,K*4E'), undefined);
  });

  it('数値でないフィールドを NaN として描画しない', () => {
    assert.doesNotMatch(summaryOf('$GPRMC,123519,A,,,,,abc,xyz,230394,,*00') ?? '', /NaN/);
  });

  it('要約ロジックが無い電文は要約を持たない', () => {
    assert.equal(summaryOf('$GPTXT,01,01,02,u-blox*4A'), undefined);
  });
});
