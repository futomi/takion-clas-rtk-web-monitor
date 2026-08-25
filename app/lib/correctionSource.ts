import { GGA_QUALITY } from './constants';
import type { CorrectionMode } from './types';

/** 基準局名が未指定のときに表示する既定のラベル */
const DEFAULT_CASTER_LABEL = 'RTK2GO';

/** 現在どの補正ソースが効いているかを表す表示用の記述。UI が実際に読むフィールドのみを持つ */
export type ActiveSource = {
  /** CSS クラス名に使うソース種別 */
  type: 'none' | 'clas' | 'clas-converging' | 'ntrip' | 'ntrip-converging';
  /** バッジに出す短いラベル */
  badgeShort: string;
  /** ステータス行に出す説明文 */
  detail: string;
  /** 測位品質ラベルへ付け足す接尾辞 */
  suffix: string;
};

export type ActiveSourceInput = {
  mode: CorrectionMode;
  /** 測位品質。{@link GGA_QUALITY} のいずれか */
  quality: number;
  /** NTRIP が接続済みかつ直近に RTCM を受信しているか */
  isNtripActive: boolean;
  /** 直近に みちびき L6 フレームを受信しているか */
  isL6Active: boolean;
  /** 接続中のマウントポイント名 */
  mountpoint: string;
};

const NOT_POSITIONED: ActiveSource = {
  type: 'none',
  badgeShort: '未測位',
  detail: '測位データ待ち',
  suffix: '',
};

const STANDALONE: ActiveSource = {
  type: 'none',
  badgeShort: '⚪ 単独測位',
  detail: 'GNSS 単独測位',
  suffix: '',
};

/**
 * 補正モード・測位品質・各補正ソースの生存状況から、画面に出す補正ソース記述を決める。
 *
 * 優先順位は「単独測位モードの明示選択 → 高精度 Fix → 高精度 Float → 単独測位 → 未測位」。
 * 高精度状態では NTRIP の生存を先に見て、生きていなければ CLAS 由来と判断する。
 */
export function resolveActiveSource({
  mode,
  quality,
  isNtripActive,
  isL6Active,
  mountpoint,
}: ActiveSourceInput): ActiveSource {
  const caster = mountpoint || DEFAULT_CASTER_LABEL;

  // 単独測位モードが明示的に選ばれている場合、受信機内部が CLAS で解けていてもそう表示する
  if (mode === 'none') {
    if (quality === GGA_QUALITY.PRECISE_FIX) return { ...STANDALONE, detail: '単独測位 (内部CLAS Fix)' };
    if (quality === GGA_QUALITY.PRECISE_FLOAT) return { ...STANDALONE, detail: '単独測位 (内部CLAS Float)' };
    return STANDALONE;
  }

  if (quality === GGA_QUALITY.PRECISE_FIX) {
    return isNtripActive
      ? { type: 'ntrip', badgeShort: '🌐 RTK Fix', detail: `RTK Fix完了 (${caster})`, suffix: ' (RTK)' }
      : { type: 'clas', badgeShort: '🛰️ CLAS Fix', detail: 'みちびきL6 補正完了', suffix: ' (CLAS)' };
  }

  if (quality === GGA_QUALITY.PRECISE_FLOAT) {
    return isNtripActive
      ? { type: 'ntrip', badgeShort: '🌐 RTK Float', detail: 'RTK 収束中 (Float)', suffix: ' (RTK)' }
      : { type: 'clas-converging', badgeShort: '🛰️ CLAS Float', detail: 'みちびきL6 収束中 (Float)', suffix: ' (CLAS)' };
  }

  if (quality === GGA_QUALITY.STANDALONE) {
    if (mode === 'clas') {
      return {
        type: 'clas-converging',
        badgeShort: isL6Active ? '🛰️ CLAS 収束中' : '🛰️ CLAS 探索中',
        detail: isL6Active ? 'みちびきL6 受信中 (収束待機)' : 'みちびきL6 探索中',
        suffix: ' (CLAS待機)',
      };
    }
    return {
      type: isNtripActive ? 'ntrip-converging' : 'none',
      badgeShort: isNtripActive ? '🌐 RTK 待機中' : '🌐 RTK 未接続',
      detail: isNtripActive ? 'RTCMデータ受信中 (RTK待機)' : 'NTRIP未接続 (単独測位)',
      suffix: isNtripActive ? ' (RTK待機)' : '',
    };
  }

  return NOT_POSITIONED;
}

/**
 * 品質バッジの色調。CSS のクラス名にそのまま使うため、
 * スタイルシート側に存在する値だけを取り得るようユニオンで縛る。
 */
export type QualityTone = 'none' | 'single' | 'float' | 'fix';

/** 測位品質コードに対応する基本ラベル */
const QUALITY_LABELS: Record<number, QualityDisplay> = {
  [GGA_QUALITY.NO_FIX]: { label: '測位できていません', short: 'NO FIX', tone: 'none' },
  [GGA_QUALITY.STANDALONE]: { label: '単独測位 (3D FIX)', short: '3D FIX', tone: 'single' },
  [GGA_QUALITY.DGPS]: { label: 'DGPS測位', short: 'DGPS', tone: 'float' },
  [GGA_QUALITY.PRECISE_FIX]: { label: '高精度測位 Fix', short: 'FIX', tone: 'fix' },
  [GGA_QUALITY.PRECISE_FLOAT]: { label: '高精度測位 Float', short: 'FLOAT', tone: 'float' },
  [GGA_QUALITY.DEAD_RECKONING]: { label: '推測航法', short: 'DR', tone: 'single' },
};

export type QualityDisplay = {
  label: string;
  short: string;
  tone: QualityTone;
};

/** 測位品質コードと補正ソースから、品質バッジの表示内容を決める */
export function resolveQualityDisplay(quality: number | undefined, suffix: string): QualityDisplay {
  const code = quality ?? GGA_QUALITY.NO_FIX;
  const base = QUALITY_LABELS[code];
  if (!base) return { label: `測位品質 ${code}`, short: `Q${code}`, tone: 'single' };
  // 高精度測位のときだけ、どの補正ソースで解けたかをラベルに添える
  const isPrecise = code === GGA_QUALITY.PRECISE_FIX || code === GGA_QUALITY.PRECISE_FLOAT;
  return isPrecise ? { ...base, label: `${base.label}${suffix}` } : base;
}
