import type { ActiveSource, QualityDisplay } from '../lib/correctionSource';
import { formatValue } from '../lib/format';
import type { Telemetry } from '../lib/telemetry';
import type { ConnectionState } from '../lib/types';
import SatelliteBreakdownBadges from './SatelliteBreakdownBadges';

type FixPanelProps = {
  telemetry: Telemetry;
  activeSource: ActiveSource;
  quality: QualityDisplay;
  connection: ConnectionState;
  /** 最終受信からの経過時間の表示文字列 */
  lastAge: string;
};

/** PDOP から衛星配置の良し悪しを判定する閾値 */
const DOP_GREAT = 1.2;
const DOP_GOOD = 2.5;

/** PDOP 値に対応する評価タグ。`tone` は CSS クラス名にそのまま使う */
function dopRating(pdop: number): { tone: 'great' | 'good' | 'fair'; label: string } {
  if (pdop <= DOP_GREAT) return { tone: 'great', label: '● 極めて良好' };
  if (pdop <= DOP_GOOD) return { tone: 'good', label: '● 良好' };
  return { tone: 'fair', label: '● 普通' };
}

/** 使用衛星・可視衛星それぞれの総数と内訳 */
function SatelliteGroup({ title, total, breakdown }: {
  title: string;
  total: number | undefined;
  breakdown: Telemetry['satellitesUsedBreakdown'];
}) {
  return (
    <div className="sat-group">
      <div className="sat-group-header">
        <span className="sat-group-title">{title}</span>
        <span className="sat-group-total"><strong>{total ?? '—'}</strong> <small>SV</small></span>
      </div>
      <SatelliteBreakdownBadges breakdown={breakdown} />
    </div>
  );
}

/** DOP 値のカード 1 枚 */
function DopCard({ label, unit, value, primary = false }: {
  label: string;
  unit: string;
  value: number | undefined;
  primary?: boolean;
}) {
  return (
    <div className={`dop-card ${primary ? 'primary' : ''}`}>
      <div className="dop-card-label">{label} <small>{unit}</small></div>
      <div className="dop-card-value">{formatValue(value, 2)}</div>
    </div>
  );
}

/** 測位ステータスパネル */
export default function FixPanel({ telemetry, activeSource, quality, connection, lastAge }: FixPanelProps) {
  const rating = telemetry.pdop === undefined ? null : dopRating(telemetry.pdop);

  return (
    <article className="fix-panel panel">
      <div className="panel-heading">
        <div className="panel-title-with-badge">
          <h3>測位ステータス</h3>
          <span className={`source-tag ${activeSource.type}`}>{activeSource.badgeShort}</span>
        </div>
        <span className={`signal-orbit ${connection === 'connected' ? 'active' : ''}`} aria-hidden="true">
          <i /><i /><i />
        </span>
      </div>

      <div className="fix-state">
        <span className={`fix-indicator ${quality.tone}`} />
        <div>
          <strong>{quality.label}</strong>
          <span className="fix-source-detail">
            {connection === 'connected' ? `${activeSource.detail} · ${lastAge}` : '受信機を接続してください'}
          </span>
        </div>
      </div>

      <div className="satellites-section">
        <SatelliteGroup
          title="使用衛星"
          total={telemetry.satellitesUsed}
          breakdown={telemetry.satellitesUsedBreakdown}
        />
        <SatelliteGroup
          title="可視衛星"
          total={telemetry.satellitesInView}
          breakdown={telemetry.satellitesInViewBreakdown}
        />
      </div>

      <div className="dop-container">
        <div className="dop-header">
          <span className="dop-title">衛星配置・精度低下率 (DOP)</span>
          {rating && <span className={`dop-status-tag ${rating.tone}`}>{rating.label}</span>}
        </div>
        <div className="dop-grid">
          <DopCard label="HDOP" unit="水平" value={telemetry.hdop} />
          <DopCard label="PDOP" unit="3D" value={telemetry.pdop} primary />
          <DopCard label="VDOP" unit="垂直" value={telemetry.vdop} />
        </div>
      </div>
    </article>
  );
}
