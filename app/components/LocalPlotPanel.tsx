'use client';

import type { LocalPlot } from '../hooks/useLocalPlot';
import type { TrackReplay } from '../hooks/useTrackReplay';
import { PLOT_RANGE_OPTIONS } from '../lib/constants';
import { resolveQualityDisplay } from '../lib/correctionSource';
import { formatPlaneLength, toPlanePosition, type PlanePosition, type PlotOrigin } from '../lib/localPlane';
import type { TrackPoint } from '../lib/track';
import LocalPlotCanvas from './LocalPlotCanvas';
import ReplayBar from './ReplayBar';

type LocalPlotPanelProps = {
  plot: LocalPlot;
  replay: TrackReplay;
  /** 画面いっぱいに広げているか。読み上げ値の大きさを変える */
  isExpanded: boolean;
};

/**
 * 符号付きの変位を「東へ 12.1 cm」のように向きの言葉で表す。
 * 専門家でない人にも、プラスマイナスより向きの言葉のほうが伝わる。
 */
function describeAxis(meters: number, positive: string, negative: string): string {
  const length = formatPlaneLength(meters);
  if (length.startsWith('0.0 cm')) return length;
  return `${meters > 0 ? positive : negative} ${length}`;
}

type PlotReadoutProps = {
  latest: TrackPoint;
  origin: PlotOrigin;
  replay: TrackReplay;
};

/** 左上の読み上げ値。原点からの距離を主役にし、向きごとの内訳と測位品質を添える */
function PlotReadout({ latest, origin, replay }: PlotReadoutProps) {
  const position: PlanePosition = toPlanePosition(origin, latest);
  const quality = resolveQualityDisplay(latest.quality, '');

  return (
    <div className="plot-readout" aria-live="off">
      {replay.isActive && (
        <span className="plot-replay-badge" title={replay.fileName}>
          <span className="track-record-dot recording" aria-hidden="true" />
          リプレイ · {replay.fileName}
        </span>
      )}
      <div className="plot-readout-main">
        <span className="plot-readout-label">原点からの距離</span>
        <strong>{formatPlaneLength(position.distance)}</strong>
      </div>
      <dl className="plot-readout-axes">
        <div>
          <dt>東西</dt>
          <dd>{describeAxis(position.east, '東へ', '西へ')}</dd>
        </div>
        <div>
          <dt>南北</dt>
          <dd>{describeAxis(position.north, '北へ', '南へ')}</dd>
        </div>
        <div>
          <dt>高さ</dt>
          <dd>{position.up === undefined ? '—' : describeAxis(position.up, '上へ', '下へ')}</dd>
        </div>
      </dl>
      <p className="plot-readout-quality">
        <span className={`fix-indicator ${quality.tone}`} />
        <span>{quality.short}</span>
        {latest.horizontalError !== undefined && (
          <span>推定誤差 {formatPlaneLength(latest.horizontalError)}</span>
        )}
      </p>
    </div>
  );
}

/**
 * 拡大プロットの本体。白紙の平面・読み上げ値・範囲と原点の操作・記録の再生操作をまとめる。
 *
 * 現在地マップと入れ替わりでパネルの下段に入る。地図と違って外部のタイルを読まないので、
 * 読み込み中の表示は持たない。
 */
export default function LocalPlotPanel({ plot, replay, isExpanded }: LocalPlotPanelProps) {
  const { samples, origin, latest, rangeMeters } = plot;
  const waitingMessage = replay.isActive ? '再生の開始を待っています' : '測位データを待っています';

  return (
    <div className={`plot-canvas-wrap${isExpanded ? ' is-expanded' : ''}`}>
      <LocalPlotCanvas samples={samples} origin={origin} rangeMeters={rangeMeters} showGauge />

      {latest && origin
        ? <PlotReadout latest={latest} origin={origin} replay={replay} />
        : <div className="map-waiting"><span className="status-dot" />{waitingMessage}</div>}

      <div className="track-controls plot-toolbar">
        <label className="track-interval">
          <span>範囲</span>
          <select value={rangeMeters} onChange={(event) => plot.setRangeMeters(Number(event.target.value))}>
            {PLOT_RANGE_OPTIONS.map((option) => (
              <option value={option} key={option}>±{option} m</option>
            ))}
          </select>
        </label>
        <button type="button" className="track-button ghost" disabled={!latest} onClick={plot.setOriginHere}>
          ここを原点にする
        </button>
        <button type="button" className="track-button ghost" disabled={samples.length < 2} onClick={plot.clearTrail}>
          軌跡を消す
        </button>
      </div>

      <ReplayBar replay={replay} />
    </div>
  );
}
