import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MESSAGE_CATEGORY_LABELS,
  NMEA_DICTIONARY,
  RTCM_DICTIONARY,
  SELECTABLE_MESSAGE_CATEGORIES,
  UBX_DICTIONARY,
  getAllMessageDefinitions,
  getMessageDefinition,
} from '../app/lib/messageDictionary.ts';
import { ubxMessageType } from '../app/lib/ubx.ts';

describe('辞書の整合性', () => {
  it('すべてのエントリでキーと type フィールドが一致する', () => {
    for (const dictionary of [NMEA_DICTIONARY, UBX_DICTIONARY, RTCM_DICTIONARY]) {
      for (const [key, definition] of Object.entries(dictionary)) {
        assert.equal(definition.type, key, `${key} の type が一致していません`);
      }
    }
  });

  it('type で引き直すと同じ定義に戻る', () => {
    for (const definition of getAllMessageDefinitions()) {
      assert.equal(getMessageDefinition(definition.type), definition, `${definition.type} を引き直せません`);
    }
  });

  it('全エントリが表示名と要約を持つ', () => {
    for (const definition of getAllMessageDefinitions()) {
      assert.ok(definition.displayName, `${definition.type} に displayName がありません`);
      assert.ok(definition.summary, `${definition.type} に summary がありません`);
      assert.ok(definition.titleJa, `${definition.type} に titleJa がありません`);
    }
  });

  it('UBX 辞書のエントリはすべて解析結果から到達できる', () => {
    // parseUbx が生成しうる種別名だけが辞書に載っているべき
    const reachable = new Set([
      ubxMessageType(0x01, 0x07),
      ubxMessageType(0x01, 0x03),
      ubxMessageType(0x01, 0x43),
      ubxMessageType(0x02, 0x73),
      ubxMessageType(0x05, 0x01),
      ubxMessageType(0x05, 0x00),
      ubxMessageType(0x06, 0x8b),
    ]);
    for (const key of Object.keys(UBX_DICTIONARY)) {
      assert.ok(reachable.has(key), `${key} は parseUbx から生成されません`);
    }
  });
});

describe('getMessageDefinition', () => {
  it('辞書登録済みの電文をそのまま返す', () => {
    assert.equal(getMessageDefinition('GGA').category, 'position');
    assert.equal(getMessageDefinition('QZSSL6').category, 'clas');
    assert.equal(getMessageDefinition('RTCM1005').category, 'rtk');
  });

  it('未登録の MSM 番号帯から系統と MSM レベルを導出する', () => {
    assert.equal(getMessageDefinition('RTCM1075').summary, 'GPS衛星群の観測データ (MSM5)');
    assert.equal(getMessageDefinition('RTCM1085').summary, 'GLONASS衛星群の観測データ (MSM5)');
    assert.equal(getMessageDefinition('RTCM1093').summary, 'Galileo衛星群の観測データ (MSM3)');
    assert.equal(getMessageDefinition('RTCM1115').summary, 'QZSS (みちびき)衛星群の観測データ (MSM5)');
    assert.equal(getMessageDefinition('RTCM1126').summary, 'BeiDou衛星群の観測データ (MSM6)');
  });

  it('MSM 番号帯の境界を正しく扱う', () => {
    assert.match(getMessageDefinition('RTCM1071').summary, /MSM1/);
    assert.match(getMessageDefinition('RTCM1076').summary, /MSM6/);
    // 1078 は MSM 帯の外なので汎用解説になる
    assert.match(getMessageDefinition('RTCM1078').titleJa, /RTCM3 補正データ/);
    // 個別辞書に載っている番号は生成より辞書を優先する
    assert.equal(getMessageDefinition('RTCM1077').titleJa, 'GPS 高精度観測データ (MSM7)');
  });

  it('未知の RTCM は汎用解説にフォールバックする', () => {
    const definition = getMessageDefinition('RTCM4094');
    assert.equal(definition.category, 'rtk');
    assert.match(definition.summary, /ID 4094/);
  });

  it('未知の電文は「その他」カテゴリになる', () => {
    const definition = getMessageDefinition('0A/36');
    assert.equal(definition.category, 'other');
    assert.equal(definition.type, '0A/36');
  });
});

describe('カテゴリラベル', () => {
  it('絞り込み対象のカテゴリはすべてラベルを持つ', () => {
    for (const category of SELECTABLE_MESSAGE_CATEGORIES) {
      assert.ok(MESSAGE_CATEGORY_LABELS[category], `${category} のラベルがありません`);
    }
  });

  it('辞書に載っている電文のカテゴリはすべて絞り込みで選べる', () => {
    for (const definition of getAllMessageDefinitions()) {
      assert.ok(
        SELECTABLE_MESSAGE_CATEGORIES.includes(definition.category),
        `${definition.type} の ${definition.category} が絞り込み対象に含まれていません`,
      );
    }
  });
});

describe('RTCM 電文のフォールバック', () => {
  it('個別に登録の無い MSM も番号帯から衛星系と段階を割り出す', () => {
    // 1101 番台 (SBAS) と 1131 番台 (NavIC) は個別辞書に無く、この番号帯から組み立てる
    const cases: [string, string, string][] = [
      ['RTCM1101', 'SBAS', 'MSM1'],
      ['RTCM1104', 'SBAS', 'MSM4'],
      ['RTCM1107', 'SBAS', 'MSM7'],
      ['RTCM1134', 'NavIC (IRNSS)', 'MSM4'],
    ];

    for (const [type, systemName, msmLevel] of cases) {
      const definition = getMessageDefinition(type);
      assert.ok(definition.titleJa.includes(systemName), `${type} の系統: ${definition.titleJa}`);
      assert.ok(definition.summary.includes(msmLevel), `${type} の MSM 段階: ${definition.summary}`);
      assert.equal(definition.category, 'rtk');
    }
  });

  it('MSM 番号帯を 7 種で区切り、隣の系統へはみ出さない', () => {
    assert.ok(getMessageDefinition('RTCM1107').titleJa.includes('SBAS'));
    // 1108〜1110 は MSM として割り当てが無く、SBAS 側へ吸い込まれてはいけない
    assert.ok(!getMessageDefinition('RTCM1108').titleJa.includes('SBAS'));
  });

  it('個別辞書に登録済みの MSM はそちらの解説を優先する', () => {
    // 番号帯からの自動生成より、人が書いた解説のほうが具体的
    assert.equal(getMessageDefinition('RTCM1074'), RTCM_DICTIONARY.RTCM1074);
  });

  it('番号を読み取れなかった RTCM3 を電文番号 3 と取り違えない', () => {
    // parseRtcm はメッセージ種別を読めない場合に 'RTCM3' を返す。
    // 'RTCM' の後ろを素直に数値化すると、存在しない ID 3 として表示してしまう
    const definition = getMessageDefinition('RTCM3');
    assert.equal(definition.category, 'rtk');
    assert.match(definition.summary, /ID 不明/);
    assert.doesNotMatch(definition.summary, /ID 3\b/);
  });

  it('MSM 帯の外にある未登録の RTCM 電文は汎用解説へ落とす', () => {
    const definition = getMessageDefinition('RTCM1299');
    assert.equal(definition.category, 'rtk');
    assert.match(definition.summary, /ID 1299/);
  });
});
