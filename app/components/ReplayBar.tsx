'use client';

import { useRef, type ChangeEvent } from 'react';
import type { TrackReplay } from '../hooks/useTrackReplay';
import { formatDuration } from '../lib/format';
import { replayProgress } from '../lib/trackReplay';

type ReplayBarProps = {
  replay: TrackReplay;
};

/** ファイル選択で受け付ける拡張子と MIME タイプ。判定そのものは中身で行う */
const ACCEPTED_FILES = '.csv,.gpx,.geojson,.json,text/csv,application/gpx+xml,application/geo+json,application/json';

/**
 * 拡大プロットの下端に置く、記録ファイルの再生操作。
 *
 * 受信機を繋げない場所で屋外の記録をそのまま見せるためのもの。
 * 再生している間は読み上げ値に「リプレイ」の印が出るので、ここでは操作だけを受け持つ。
 */
export default function ReplayBar({ replay }: ReplayBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void replay.load(file);
    // 同じファイルを選び直しても change が発火するよう、選択を空に戻す
    event.target.value = '';
  };

  if (!replay.isActive) {
    return (
      <div className="plot-replay-bar is-empty">
        <button type="button" className="track-button ghost" onClick={() => inputRef.current?.click()}>
          記録ファイルを再生…
        </button>
        <input ref={inputRef} type="file" accept={ACCEPTED_FILES} onChange={handleFileChange} hidden />
        <span className="plot-replay-hint">書き出した CSV / GPX / GeoJSON を、記録どおりの間隔で再生します</span>
        {replay.error && <span className="plot-replay-error" role="alert">{replay.error}</span>}
      </div>
    );
  }

  const { elapsedMs, totalMs } = replayProgress(replay.points, replay.index);
  const primaryAction = replay.status === 'playing'
    ? { label: '一時停止', onClick: replay.pause }
    : replay.status === 'finished'
      ? { label: '最初から', onClick: replay.restart }
      : { label: '再生', onClick: replay.play };

  return (
    <div className="plot-replay-bar">
      <span className="plot-replay-file" title={replay.fileName}>{replay.fileName}</span>
      <span className="plot-replay-progress">
        {formatDuration(elapsedMs)} / {formatDuration(totalMs)} · {replay.index + 1}/{replay.points.length} 点
      </span>
      <progress className="plot-replay-meter" max={Math.max(totalMs, 1)} value={elapsedMs} />
      <button type="button" className="track-button primary" onClick={primaryAction.onClick}>
        {primaryAction.label}
      </button>
      {replay.status !== 'finished' && replay.index > 0 && (
        <button type="button" className="track-button ghost" onClick={replay.restart}>最初から</button>
      )}
      <button type="button" className="track-button ghost" onClick={replay.eject}>閉じる</button>
    </div>
  );
}
