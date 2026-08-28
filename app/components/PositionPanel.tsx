import { memo } from 'react';
import type { ActiveSource, QualityDisplay } from '../lib/correctionSource';
import { hasPosition, type Telemetry } from '../lib/telemetry';

type PositionPanelProps = {
  telemetry: Telemetry;
  activeSource: ActiveSource;
  quality: QualityDisplay;
};

/** 緯度・経度の 1 行。符号を方角表記に分けて表示する */
function CoordinateRow({ axis, value, positive, negative }: {
  axis: string;
  value: number | undefined;
  positive: string;
  negative: string;
}) {
  return (
    <div className="coordinate-row">
      <span className="axis">{axis}</span>
      <strong>{value === undefined ? '— — —' : Math.abs(value).toFixed(9)}</strong>
      <span className="direction">{value === undefined ? '' : value >= 0 ? positive : negative}</span>
    </div>
  );
}

/** 数値と単位を組にしたメタ情報 */
function MetaItem({ label, value, unit, digits = 3 }: {
  label: string;
  value: number | string | undefined;
  unit?: string;
  digits?: number;
}) {
  const text = typeof value === 'number' ? value.toFixed(digits) : value;
  return (
    <div>
      <span>{label}</span>
      <strong>{text === undefined ? '—' : <>{text} {unit && <small>{unit}</small>}</>}</strong>
    </div>
  );
}

/** 現在位置パネル */
function PositionPanel({ telemetry, activeSource, quality }: PositionPanelProps) {
  const positioned = hasPosition(telemetry);

  return (
    <article className="panel">
      <div className="panel-heading">
        <div className="panel-title-with-badge">
          <h3>現在位置</h3>
          <span className={`source-tag ${activeSource.type}`}>{activeSource.badgeShort}</span>
        </div>
        <span className={`fix-badge ${quality.tone}`}>{quality.short}</span>
      </div>

      <div className={`coordinate-display ${positioned ? 'has-position' : ''}`}>
        <CoordinateRow axis="LAT" value={telemetry.latitude} positive="N" negative="S" />
        <CoordinateRow axis="LON" value={telemetry.longitude} positive="E" negative="W" />
      </div>

      <div className="position-meta">
        <MetaItem label="標高" value={telemetry.altitude} unit="m" />
        <MetaItem label="推定水平誤差" value={telemetry.horizontalError} unit="m" />
        {/* 単位はラベルが兼ねる。値の後ろにも UTC を添えると同じ語が 2 度出る */}
        <MetaItem label="UTC" value={telemetry.timeUtc} />
      </div>
    </article>
  );
}

/*
 * 親は経過時間の表示のため毎秒、測位状態の更新のためさらに細かく再描画される。
 * このパネルは自分が受け取る値にしか依存しないので memo で包み、
 * 関係のない再描画に巻き込まれないようにする。
 */
export default memo(PositionPanel);
