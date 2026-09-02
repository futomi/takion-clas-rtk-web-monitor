'use client';

import { useCallback, useState } from 'react';
import { DEFAULT_PLOT_RANGE_M } from '../lib/constants';
import { appendPlotSample, chooseOrigin, originFromPoint, type PlotOrigin } from '../lib/localPlane';
import type { TrackPoint } from '../lib/track';

/** 入力元ごとにまとめて持つ状態。key が変われば丸ごと捨てる */
type PlotState = {
  key: string;
  /** 最後に取り込んだ点。同じ点を二度取り込まないための控え */
  point: TrackPoint | null;
  samples: TrackPoint[];
  origin: PlotOrigin | null;
};

const emptyState = (key: string): PlotState => ({ key, point: null, samples: [], origin: null });

/**
 * 拡大プロットの状態。原点まわり数 m の範囲に、最新の点とその尾を描くための材料を持つ。
 *
 * 記録機能とは別に点を抱えるのは、あちらが 1 秒以上の間隔で間引き、
 * 30 cm 未満の変位を距離に数えないため。ここで見せたいのはまさにその範囲の動きなので、
 * 届いた全エポックをそのまま使い、記録を始めていなくても動く。
 *
 * @param point 最新の 1 点。受信機の測位解か、記録ファイルの再生位置
 * @param sourceKey 入力元の識別子。変わったら尾と原点を捨てる（実機 ⇄ 再生、再生の最初から）
 */
export function useLocalPlot(point: TrackPoint | null, sourceKey: string) {
  const [state, setState] = useState<PlotState>(() => emptyState(sourceKey));
  const [rangeMeters, setRangeMeters] = useState<number>(DEFAULT_PLOT_RANGE_M);

  /*
   * 新しい点は描画の途中で取り込む（React の「描画中に state を調整する」形）。
   * effect で取り込むと、点が届くたびに「描く → effect で state を進める → もう一度描く」となり、
   * 1 エポックにつき描画が 1 回余計に走る。描画中に進めれば React はコミット前にやり直すだけで済む。
   * 入力元が変わったときも同じ場所で捨てる。
   */
  let next = state.key === sourceKey ? state : emptyState(sourceKey);
  if (point !== next.point) {
    next = point
      ? {
        ...next,
        point,
        samples: appendPlotSample(next.samples, point),
        origin: chooseOrigin(next.origin, point) ?? next.origin,
      }
      : { ...next, point };
  }
  if (next !== state) setState(next);

  /** 今いる場所を原点にする。手で置いた原点は、以後 Fix しても自動では動かさない */
  const setOriginHere = useCallback(() => {
    setState((current) => {
      const latest = current.samples[current.samples.length - 1];
      return latest ? { ...current, origin: originFromPoint(latest, true) } : current;
    });
  }, []);

  /** 尾を消す。最新の点だけは残し、原点はそのままにする */
  const clearTrail = useCallback(() => {
    setState((current) => {
      const latest = current.samples[current.samples.length - 1];
      return { ...current, samples: latest ? [latest] : [] };
    });
  }, []);

  const latest = next.samples.length > 0 ? next.samples[next.samples.length - 1] : null;

  return {
    samples: next.samples,
    origin: next.origin,
    latest,
    rangeMeters,
    setRangeMeters,
    setOriginHere,
    clearTrail,
  };
}

/** 拡大プロットのフックが返す一式。描画側がそのまま受け取る */
export type LocalPlot = ReturnType<typeof useLocalPlot>;
