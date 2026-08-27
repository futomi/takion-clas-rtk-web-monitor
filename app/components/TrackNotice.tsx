'use client';

import type { TrackRecorder } from '../hooks/useTrackRecorder';
import { formatDuration } from '../lib/format';

/**
 * 軌跡記録からの通知。現在地マップの見出しと地図の間に差し込む。
 *
 * 復元の知らせと、記録を続けられなくなったときの知らせを扱う。
 * どちらも操作そのものは見出し行のボタンに任せ、ここでは状況の説明だけを出す。
 */
export default function TrackNotice({ track }: { track: TrackRecorder }) {
  const { isRestored, notice, stats } = track;
  if (!isRestored && !notice) return null;

  const restoredSpan = stats.startedAt !== null && stats.endedAt !== null
    ? formatDuration(stats.endedAt - stats.startedAt)
    : '';

  return (
    <div className="track-notice-area">
      {isRestored && (
        <div className="track-notice restored" role="status">
          <span>
            中断された記録を復元しました（{stats.count.toLocaleString()}点
            {restoredSpan && ` / ${restoredSpan}`}）。
            「再開」を押すと同じ軌跡へ書き足します。
          </span>
          <button
            type="button"
            className="track-notice-close"
            onClick={track.dismissRestored}
            aria-label="通知を閉じる"
          >
            ×
          </button>
        </div>
      )}

      {notice && (
        <div className="track-notice warning" role="alert">
          <span>{notice}</span>
          <button
            type="button"
            className="track-notice-close"
            onClick={track.dismissNotice}
            aria-label="通知を閉じる"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
