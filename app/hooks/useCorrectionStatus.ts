'use client';

import { useMemo } from 'react';
import { L6_ACTIVE_WINDOW_MS, NTRIP_ACTIVE_WINDOW_MS } from '../lib/constants';
import { resolveActiveSource, resolveQualityDisplay } from '../lib/correctionSource';
import type { CorrectionMode, NtripStatus } from '../lib/types';

type UseCorrectionStatusOptions = {
  mode: CorrectionMode;
  /** 受信機が報告する測位品質コード */
  quality: number | undefined;
  ntripStatus: NtripStatus;
  /** 最後に RTCM を受け取った時刻 */
  ntripLastDataAt: number | null;
  /** 最後に みちびき L6 フレームを受け取った時刻 */
  lastL6At: number | null;
  /** 接続中のマウントポイント名 */
  mountpoint: string;
  /** 毎秒進む時計。生存判定の基準時刻に使う */
  clock: number;
};

/**
 * 「いま効いている補正ソースは何か」の判定をまとめたフック。
 *
 * 補正の生存判定は最終受信時刻からの経過で決まるため、時計の進みに追随する必要がある。
 * 判定に必要な入力と導出結果をここへ集め、画面側は結果だけを描画すればよいようにしている。
 */
export function useCorrectionStatus({
  mode,
  quality,
  ntripStatus,
  ntripLastDataAt,
  lastL6At,
  mountpoint,
  clock,
}: UseCorrectionStatusOptions) {
  // 補正ソースが「今まさに効いているか」を最終受信時刻から判定する
  const isNtripActive = ntripStatus === 'connected'
    && ntripLastDataAt !== null
    && clock - ntripLastDataAt < NTRIP_ACTIVE_WINDOW_MS;
  const isL6Active = lastL6At !== null && clock - lastL6At < L6_ACTIVE_WINDOW_MS;

  const activeSource = useMemo(
    () => resolveActiveSource({
      mode,
      quality: quality ?? 0,
      isNtripActive,
      isL6Active,
      mountpoint,
    }),
    [mode, quality, isNtripActive, isL6Active, mountpoint],
  );

  const qualityDisplay = useMemo(
    () => resolveQualityDisplay(quality, activeSource.suffix),
    [quality, activeSource.suffix],
  );

  return { isL6Active, activeSource, quality: qualityDisplay };
}
