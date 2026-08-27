'use client';

import type { TrackRecorder } from '../hooks/useTrackRecorder';
import { TRACK_INTERVAL_OPTIONS } from '../lib/constants';
import { formatDistance, formatDuration } from '../lib/format';
import { exportTrack, TRACK_EXPORT_FORMATS, type TrackExport, type TrackExportFormat } from '../lib/trackExport';

type TrackControlsProps = {
  track: TrackRecorder;
  /** 毎秒進む時計。記録中の経過時間表示に使う */
  clock: number;
  /** 軌跡を地図に描いているか */
  showTrack: boolean;
  onToggleTrack: () => void;
};

/** 書き出し形式ごとのボタン表記 */
const FORMAT_LABELS: Record<TrackExportFormat, string> = {
  csv: 'CSV',
  gpx: 'GPX',
  geojson: 'GeoJSON',
};

/**
 * 組み立てた内容をファイルとして保存させる。
 *
 * オブジェクト URL の解放を少し遅らせているのは、click() が同期でも
 * ブラウザが Blob を読み出すのはその後になるため。即座に解放すると
 * 空のファイルが落ちてくることがある。
 */
function downloadFile({ fileName, mimeType, content }: TrackExport): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 軌跡の記録操作。現在地マップの見出し行に置く。
 *
 * 並びは「情報 → 副次的な操作 → 主操作」で、主ボタンは常に右端に置く。
 * 状態によって要素の数が変わるため、主ボタンを先頭に置くと記録の開始・停止の
 * たびにボタンが横へ大きく飛んでしまう。右端なら要素が増減しても位置が動かない。
 *
 * 記録中でもダウンロードできるようにしているのは、長時間の記録を
 * 止めずに途中経過を保存したい場面があるため。
 */
export default function TrackControls({ track, clock, showTrack, onToggleTrack }: TrackControlsProps) {
  const { status, stats } = track;

  // 主ボタンは状態ごとに役割が変わるだけの同じ 1 つのボタン。
  // 状態ごとに別々の要素として書くと、React が付け替えのたびに作り直してしまう
  const primaryAction = status === 'recording'
    ? { label: '停止', tone: 'stop', onClick: track.stop }
    : status === 'idle'
      ? { label: '記録開始', tone: 'start', onClick: track.start }
      : { label: '再開', tone: 'start', onClick: track.resume };

  // 記録中は今この瞬間まで、停止後は最後の点までを経過時間とする
  const elapsedMs = stats.startedAt === null
    ? 0
    : Math.max(0, (status === 'recording' ? clock : stats.endedAt ?? stats.startedAt) - stats.startedAt);

  const handleDownload = (format: TrackExportFormat) => {
    if (track.points.length === 0 || stats.startedAt === null) return;
    downloadFile(exportTrack(track.points, format, stats.startedAt));
  };

  const handleClear = () => {
    if (window.confirm(`記録した ${stats.count.toLocaleString()} 点の軌跡を削除します。よろしいですか？`)) {
      track.clear();
    }
  };

  return (
    <div className="track-controls">
      {status === 'idle' && (
        <label className="track-interval">
          <span>記録間隔</span>
          <select
            value={track.intervalMs}
            onChange={(event) => track.setIntervalMs(Number(event.target.value))}
          >
            {TRACK_INTERVAL_OPTIONS.map((option) => (
              <option value={option} key={option}>{option / 1000}秒</option>
            ))}
          </select>
        </label>
      )}

      {status !== 'idle' && (
        <p className="track-stats" aria-live="polite">
          <span>{formatDuration(elapsedMs)}</span>
          <span>{stats.count.toLocaleString()}点</span>
          <span>{formatDistance(stats.distanceMeters)}</span>
        </p>
      )}

      {/* 記録した軌跡がある間だけ出す。地図の見え方だけを変え、記録には触れない */}
      {stats.count > 0 && (
        <button
          type="button"
          className="track-button ghost"
          aria-pressed={showTrack}
          onClick={onToggleTrack}
        >
          {showTrack ? '軌跡を隠す' : '軌跡を表示'}
        </button>
      )}

      {status !== 'idle' && (
        <span className="track-download">
          {TRACK_EXPORT_FORMATS.map((format) => (
            <button
              type="button"
              key={format}
              className="track-button ghost"
              disabled={stats.count === 0}
              onClick={() => handleDownload(format)}
            >
              {FORMAT_LABELS[format]}
            </button>
          ))}
        </span>
      )}

      {status === 'stopped' && (
        <button type="button" className="track-button ghost" onClick={handleClear}>クリア</button>
      )}

      {/* ラベルの文字数が状態ごとに違うため、最小幅を揃えて中心もずらさない */}
      <button
        type="button"
        className={`track-button primary ${primaryAction.tone}`}
        onClick={primaryAction.onClick}
      >
        <span
          className={`track-record-dot ${status === 'recording' ? 'recording' : ''}`}
          aria-hidden="true"
        />
        {primaryAction.label}
      </button>
    </div>
  );
}
