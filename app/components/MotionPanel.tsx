import { memo } from 'react';
import { formatValue } from '../lib/format';
import type { Telemetry } from '../lib/telemetry';

/**
 * 進行方向インジケータの位置（0〜100%）。360 度を全幅に対応させる。
 *
 * この値は目盛り全体の幅に対する割合なので、`left` へ渡す。`transform: translateX()`
 * の % はインジケータ自身の幅が基準になるため、全域が数 px に潰れてしまう。
 */
const coursePercent = (course: number | undefined) =>
  Math.min(100, Math.max(0, (course ?? 0) / 3.6));

/** 移動情報パネル */
function MotionPanel({ telemetry }: { telemetry: Telemetry }) {
  return (
    <article className="motion-panel panel">
      <div className="panel-heading">
        <h3>移動情報</h3>
      </div>
      <div className="speed-value">
        <strong>{formatValue(telemetry.speedKmh, 1)}</strong>
        <span>km/h</span>
      </div>
      <div className="motion-meta-group">
        <div className="course-line">
          <span>進行方向</span>
          <strong>{formatValue(telemetry.course, 1, '°')}</strong>
        </div>
        <div className="course-rule">
          <span style={{ left: `${coursePercent(telemetry.course)}%` }} />
        </div>
        <div className="date-line">
          <span>測位日</span>
          <strong>{telemetry.dateUtc ?? '—'}</strong>
        </div>
      </div>
    </article>
  );
}

/*
 * 親は経過時間の表示のため毎秒、測位状態の更新のためさらに細かく再描画される。
 * このパネルは自分が受け取る値にしか依存しないので memo で包み、
 * 関係のない再描画に巻き込まれないようにする。
 */
export default memo(MotionPanel);
