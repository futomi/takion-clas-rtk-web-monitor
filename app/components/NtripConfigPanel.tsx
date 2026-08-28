'use client';

import { memo, useMemo } from 'react';
import { formatKilobytes, formatSecondsAgo } from '../lib/format';
import { isValidPort, type MountpointCandidate } from '../lib/ntrip';
import type { ConnectionState, NtripFormState, NtripLiveState, NtripStatus } from '../lib/types';

/**
 * プルダウンへ並べる配信局の最大数。
 *
 * 公開 Caster の配信局は数百局規模になる（rtk2go の実測で 694 局）。全件を `<option>` に
 * すると、測位が更新されるたびにその数だけ要素を作り直すことになり、描き直しが無駄に重い。
 * そもそも数百行のプルダウンからは目的の局を選べないため、近い順の上位だけを並べ、
 * 一覧に無い局は「手動入力」で指定してもらう。
 */
const MAX_LISTED_CANDIDATES = 50;

type NtripConfigPanelProps = {
  form: NtripFormState;
  onFormChange: (patch: Partial<NtripFormState>) => void;
  /** 自動選択を含めて実際に使われるマウントポイント */
  activeMountpoint: string;
  candidates: MountpointCandidate[];
  /** 接続状態と転送量。表示に使うぶんだけを受け取る */
  ntrip: NtripLiveState;
  clock: number;
  connection: ConnectionState;
  /** 受信機の現在位置。自動選定の基準を示すためだけに使う */
  latitude?: number;
  longitude?: number;
  onRefreshSources: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
};

/** 接続状態バッジの表示文字列 */
function statusText(status: NtripStatus, rateKbps: number): string {
  if (status === 'connected') return `RTCM受信中 (${rateKbps} KB/s)`;
  if (status === 'connecting') return '接続中…';
  if (status === 'error') return 'エラー';
  return '未接続';
}

/** 配信局の選択肢ラベル。距離が不明な局では距離表記ごと省く */
function candidateLabel(candidate: MountpointCandidate): string {
  const name = candidate.distanceKm !== null
    ? `${candidate.mountpoint} (${candidate.distanceKm.toFixed(1)} km)`
    : candidate.mountpoint;
  return `${name} · ${candidate.country || 'GLOBAL'} (${candidate.format})`;
}

/** ネットワークRTK (NTRIP) の接続設定パネル */
function NtripConfigPanel({
  form,
  onFormChange,
  activeMountpoint,
  candidates,
  ntrip,
  clock,
  connection,
  latitude,
  longitude,
  onRefreshSources,
  onConnect,
  onDisconnect,
}: NtripConfigPanelProps) {
  const { status, error, isFetchingSources, bytesReceived, rateKbps, lastDataAt } = ntrip;
  // 接続確立中および確立後は接続先を変更させない
  const isBusy = status === 'connected' || status === 'connecting';
  const isConnected = status === 'connected';
  const positioned = latitude !== undefined && longitude !== undefined;
  const portIsValid = isValidPort(form.port);

  /**
   * 実際に並べる配信局。近い順の上位だけに絞る。
   *
   * 選択中の局が上位から外れることがある（自動選定を切って遠い局を選んだ場合など）。
   * 選択肢に無い値を `<select>` へ渡すと、画面上はどれも選ばれていない状態になり、
   * 接続先が分からなくなるため、外れていても必ず 1 つ足しておく。
   */
  const listedCandidates = useMemo(() => {
    const listed = candidates.slice(0, MAX_LISTED_CANDIDATES);
    if (!activeMountpoint || listed.some((candidate) => candidate.mountpoint === activeMountpoint)) {
      return listed;
    }
    const selected = candidates.find((candidate) => candidate.mountpoint === activeMountpoint);
    return selected ? [...listed, selected] : listed;
  }, [candidates, activeMountpoint]);

  const hiddenCandidateCount = candidates.length - listedCandidates.length;

  /*
   * 自動選定が実際に効いている条件。手動入力へ切り替えている間は近い局を選び直す処理が
   * 止まる (useNtripForm の activeMountpoint と同じ条件) ので、選定根拠も出さない。
   */
  const isAutoSelecting = form.autoSelect && !form.isManualMountpoint;
  // 一覧を絞っている旨は、リストから選ぶときにしか意味がない
  const showListNote = !form.isManualMountpoint && hiddenCandidateCount > 0;
  /*
   * 注記を全幅の行へ追い出したぶん、読み上げでは欄と結び付かなくなる。
   * aria-describedby で繋ぎ直す。出していない注記の id を指すと読み上げが空振りするので、
   * 出ているものだけを並べる。
   */
  const mountpointDescribedBy = [
    showListNote ? 'ntrip-mountpoint-note' : null,
    isAutoSelecting ? 'ntrip-autoselect-note' : null,
  ].filter(Boolean).join(' ') || undefined;
  // 中身が無いまま置くと、高さ 0 の行にもグリッドの gap だけが残る
  const hasNotes = showListNote || isAutoSelecting;

  /**
   * ポート欄の入力を数値へ落とす。
   *
   * 空欄や数字以外は 0（ポート番号として不正な値）とし、下の検証で理由を提示する。
   * 既定値へ即座に戻すと、一度消してから打ち直すという当たり前の操作ができなくなる。
   */
  const parsePort = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  return (
    <section className="ntrip-config-panel panel" aria-label="NTRIP接続設定">
      <div className="ntrip-panel-header">
        <h3>ネットワークRTK 接続設定</h3>
        <div className="ntrip-status-badge">
          <span className={`ntrip-led ${status}`} />
          <span>{statusText(status, rateKbps)}</span>
        </div>
      </div>

      <div className="ntrip-grid">
        <div className="ntrip-field">
          <label htmlFor="ntrip-host">Caster サーバー / ポート</label>
          <div className="input-group">
            <input
              id="ntrip-host"
              type="text"
              value={form.host}
              onChange={(event) => onFormChange({ host: event.target.value })}
              placeholder="rtk2go.com"
              disabled={isBusy}
            />
            <input
              type="number"
              className="port-input"
              // 0 は「未入力」を表す内部値。プレースホルダを見せたいので空欄として描く
              value={form.port || ''}
              onChange={(event) => onFormChange({ port: parsePort(event.target.value) })}
              placeholder="2101"
              disabled={isBusy}
              min={1}
              max={65535}
              aria-label="ポート番号"
              aria-invalid={!portIsValid}
            />
            <button
              type="button"
              className="secondary-btn"
              onClick={onRefreshSources}
              disabled={isFetchingSources || isConnected || !portIsValid}
            >
              {isFetchingSources ? '取得中…' : '局リスト更新'}
            </button>
          </div>
          {!portIsValid && (
            <small className="field-note field-note-error">
              ポート番号は 1〜65535 の範囲で指定してください。
            </small>
          )}
        </div>

        <div className="ntrip-field">
          <label htmlFor="ntrip-mountpoint">基準局 (マウントポイント)</label>

          {form.isManualMountpoint ? (
            <div className="input-group">
              <input
                id="ntrip-mountpoint"
                type="text"
                value={form.mountpoint}
                onChange={(event) => onFormChange({ mountpoint: event.target.value })}
                placeholder="マウントポイント名 (例: SAKURA_BASE)"
                disabled={isConnected}
              />
              <button
                type="button"
                className="text-link"
                onClick={() => onFormChange({ isManualMountpoint: false })}
              >
                リスト選択に戻す
              </button>
            </div>
          ) : (
            <div className="mountpoint-select-wrapper">
              <select
                id="ntrip-mountpoint"
                value={activeMountpoint}
                onChange={(event) => onFormChange({ autoSelect: false, mountpoint: event.target.value })}
                disabled={isConnected || isFetchingSources}
                aria-describedby={mountpointDescribedBy}
              >
                {listedCandidates.length === 0 ? (
                  <option value={activeMountpoint || ''}>
                    {activeMountpoint || '局リストを取得してください'}
                  </option>
                ) : (
                  listedCandidates.map((candidate) => (
                    <option key={candidate.mountpoint} value={candidate.mountpoint}>
                      {candidateLabel(candidate)}
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                className="text-link"
                onClick={() => onFormChange({ isManualMountpoint: true })}
              >
                手動入力
              </button>
            </div>
          )}
        </div>

        <div className="ntrip-field">
          <label htmlFor="ntrip-username">ユーザー名 (メールアドレス)</label>
          <input
            id="ntrip-username"
            type="text"
            value={form.username}
            onChange={(event) => onFormChange({ username: event.target.value })}
            placeholder="user@example.com (RTK2GO接続時)"
            disabled={isConnected}
          />
        </div>

        <div className="ntrip-field">
          <label htmlFor="ntrip-password">パスワード (任意)</label>
          <input
            id="ntrip-password"
            type="password"
            value={form.password}
            onChange={(event) => onFormChange({ password: event.target.value })}
            placeholder="none (RTK2GOは不要)"
            disabled={isConnected}
            autoComplete="off"
          />
        </div>

        {/*
          注記は欄の直下ではなく、グリッド全幅の 1 行へまとめる。
          幅の狭い列に押し込むと 1 文が 3 行に折り返し、その高さがそのまま行全体の
          高さになって、他の列に空白の谷ができる。全幅なら同じ文が 1 行で収まる。

          離れたぶんの結び付きは、主語を明示する文面と aria-describedby で補う。
          入力そのものが不正なときの注記 (ポート番号) はここへ移さない。
          直すべき欄の隣にあることに意味がある。
        */}
        {hasNotes && (
          <div className="ntrip-notes">
            {showListNote && (
              /* 一覧を絞っていることは必ず伝える。黙って隠すと、繋ぎたい局が
                 配信されていないのか単に出ていないだけなのかを画面から判断できない */
              <small id="ntrip-mountpoint-note" className="field-note">
                基準局は近い順に {listedCandidates.length} 局を表示しています（全 {candidates.length} 局）。一覧に無い局は「手動入力」で指定できます。
              </small>
            )}

            {isAutoSelecting && (positioned ? (
              <small id="ntrip-autoselect-note" className="field-note coords-hint">
                🛰️ {latitude.toFixed(4)}, {longitude.toFixed(4)} に近い局を自動選定
              </small>
            ) : (
              <small id="ntrip-autoselect-note" className="field-note coords-hint waiting">
                ⚠️ 測位待ち · 測位後に近い局を自動選定
              </small>
            ))}
          </div>
        )}

        <div className="ntrip-actions">
          {isConnected ? (
            <button type="button" className="connect-button disconnect-button" onClick={onDisconnect}>
              NTRIP 切断
            </button>
          ) : (
            <button
              type="button"
              className="connect-button"
              onClick={onConnect}
              disabled={connection !== 'connected' || status === 'connecting' || !portIsValid}
            >
              {status === 'connecting' ? '接続中…' : 'NTRIP 接続開始'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="ntrip-error" role="alert">
          <span>⚠️ {error}</span>
        </div>
      )}

      {isConnected && (
        <div className="ntrip-live-bar">
          <span className="live-pill">LIVE</span>
          <span>受信サイズ: <strong>{formatKilobytes(bytesReceived)}</strong></span>
          <span>転送レート: <strong>{rateKbps} KB/s</strong></span>
          <span>最終受信: <strong>{formatSecondsAgo(lastDataAt, clock)}</strong></span>
        </div>
      )}
    </section>
  );
}

/*
 * 親は経過時間の表示のため毎秒、測位状態の更新のためさらに細かく再描画される。
 * このパネルは接続設定と転送状況にしか依存しないので memo で包み、
 * 関係のない再描画に巻き込まれないようにする
 * （そのため親から渡すハンドラはすべて同一性の保たれたものにしてある）。
 */
export default memo(NtripConfigPanel);
