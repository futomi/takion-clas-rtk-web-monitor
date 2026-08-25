import type { CorrectionMode, NtripStatus } from '../lib/types';

type CorrectionModePanelProps = {
  mode: CorrectionMode;
  onModeChange: (mode: CorrectionMode) => void;
  ntripStatus: NtripStatus;
  ntripRateKbps: number;
  isL6Active: boolean;
  l6Summary: string;
};

/** 選択中モードの見出しラベル */
function activeModeLabel(mode: CorrectionMode, ntripStatus: NtripStatus): string {
  if (mode === 'clas') return '🛰️ CLAS (みちびき L6衛星補正)';
  if (mode === 'ntrip') return `🌐 ネットワークRTK (${ntripStatus === 'connected' ? '接続中' : '未接続'})`;
  return '⚪ 単独測位';
}

/** モード選択タブ 1 つ分 */
function ModeTab({ active, icon, title, description, onClick }: {
  active: boolean;
  icon: string;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`mode-tab ${active ? 'active' : ''}`} onClick={onClick} aria-pressed={active}>
      <span className="mode-icon">{icon}</span>
      <div>
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
    </button>
  );
}

/** 補正ソースの切り替えパネル */
export default function CorrectionModePanel({
  mode,
  onModeChange,
  ntripStatus,
  ntripRateKbps,
  isL6Active,
  l6Summary,
}: CorrectionModePanelProps) {
  const clasDescription = isL6Active
    ? `🛰️ L6信号受信中 ${l6Summary ? `(${l6Summary})` : ''}`.trim()
    : '衛星信号から直接補正 (完全オフライン / 収束に数分)';

  const ntripDescription = ntripStatus === 'connected'
    ? `🌐 RTCM受信中 (${ntripRateKbps} KB/s · 即時Fix)`
    : 'インターネット経由で即時Fix (RTK2GO等)';

  return (
    <section className="correction-mode-panel panel" aria-label="補正モード選択">
      <div className="mode-header">
        <span className="card-label">CORRECTION SOURCE</span>
        <span className="mode-active-indicator">
          選択中: <strong>{activeModeLabel(mode, ntripStatus)}</strong>
        </span>
      </div>
      <div className="mode-toggle-group">
        <ModeTab
          active={mode === 'clas'}
          icon="🛰️"
          title="CLAS (みちびき L6)"
          description={clasDescription}
          onClick={() => onModeChange('clas')}
        />
        <ModeTab
          active={mode === 'ntrip'}
          icon="🌐"
          title="ネットワークRTK (NTRIP)"
          description={ntripDescription}
          onClick={() => onModeChange('ntrip')}
        />
        <ModeTab
          active={mode === 'none'}
          icon="⚪"
          title="単独測位"
          description="補正なし (通常のGNSS 3D Fix)"
          onClick={() => onModeChange('none')}
        />
      </div>
    </section>
  );
}
