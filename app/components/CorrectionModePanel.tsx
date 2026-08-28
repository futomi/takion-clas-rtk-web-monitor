import { memo } from 'react';
import type { CorrectionMode, NtripStatus } from '../lib/types';

type CorrectionModePanelProps = {
  mode: CorrectionMode;
  onModeChange: (mode: CorrectionMode) => void;
  ntripStatus: NtripStatus;
  ntripRateKbps: number;
  isL6Active: boolean;
  l6Summary: string;
};

/**
 * 選択肢の定義。
 *
 * `hint` は選択していないモードの説明で、ツールチップとしてだけ出す。
 * 3 つぶんの説明を常時並べると、それだけでパネルが 2 行ぶん高くなるため、
 * 画面に出すのは選択中のモードの現況（下の `currentStatus`）だけに絞っている。
 */
const MODE_OPTIONS: { mode: CorrectionMode; icon: string; label: string; hint: string }[] = [
  {
    mode: 'clas',
    icon: '🛰️',
    label: 'CLAS',
    hint: 'みちびき L6衛星補正。衛星信号から直接補正 (完全オフライン / 収束に数分)',
  },
  {
    mode: 'ntrip',
    icon: '🌐',
    label: 'ネットワークRTK',
    hint: 'NTRIP で配信局の RTCM を受け取り即時Fix (RTK2GO等)',
  },
  {
    mode: 'none',
    icon: '⚪',
    label: '単独測位',
    hint: '補正なし (通常のGNSS 3D Fix)',
  },
];

/**
 * 選択中モードの現況。
 *
 * `live` は補正データが実際に流れていること。真のときだけ明滅する点を添えて、
 * 「選んである」と「効いている」を見分けられるようにする。
 */
function currentStatus(
  mode: CorrectionMode,
  ntripStatus: NtripStatus,
  ntripRateKbps: number,
  isL6Active: boolean,
  l6Summary: string,
): { text: string; live: boolean } {
  if (mode === 'clas') {
    if (!isL6Active) return { text: '衛星信号から直接補正 (完全オフライン / 収束に数分)', live: false };
    return { text: `L6信号受信中${l6Summary ? ` (${l6Summary})` : ''}`, live: true };
  }
  if (mode === 'ntrip') {
    if (ntripStatus !== 'connected') return { text: 'インターネット経由で即時Fix (RTK2GO等)', live: false };
    return { text: `RTCM受信中 (${ntripRateKbps} KB/s · 即時Fix)`, live: true };
  }
  return { text: '補正なし (通常のGNSS 3D Fix)', live: false };
}

/** 補正ソースの切り替えパネル */
function CorrectionModePanel({
  mode,
  onModeChange,
  ntripStatus,
  ntripRateKbps,
  isL6Active,
  l6Summary,
}: CorrectionModePanelProps) {
  const status = currentStatus(mode, ntripStatus, ntripRateKbps, isL6Active, l6Summary);

  return (
    <section className="correction-mode-panel panel" aria-label="補正モード選択">
      <span className="card-label" id="correction-mode-label">補正ソース</span>
      <div className="mode-toggle-group" role="group" aria-labelledby="correction-mode-label">
        {MODE_OPTIONS.map((option) => (
          <button
            key={option.mode}
            type="button"
            className={`mode-tab ${mode === option.mode ? 'active' : ''}`}
            title={option.hint}
            aria-pressed={mode === option.mode}
            onClick={() => onModeChange(option.mode)}
          >
            <span className="mode-icon" aria-hidden="true">{option.icon}</span>
            {option.label}
          </button>
        ))}
      </div>
      <p className={`mode-status ${status.live ? 'live' : ''}`}>
        {status.live && <span className="mode-status-dot" aria-hidden="true" />}
        <span className="mode-status-text">{status.text}</span>
      </p>
    </section>
  );
}

/*
 * 親は経過時間の表示のため毎秒、測位状態の更新のためさらに細かく再描画される。
 * このパネルは自分が受け取る値にしか依存しないので memo で包み、
 * 関係のない再描画に巻き込まれないようにする。
 */
export default memo(CorrectionModePanel);
