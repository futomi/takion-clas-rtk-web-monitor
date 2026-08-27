'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { DEFAULT_NTRIP_PASSWORD, rankMountpoints, type MountpointSummary } from '../lib/ntrip';
import {
  getNtripConfigSnapshot,
  getServerNtripConfigSnapshot,
  saveNtripConfig,
  subscribeNtripConfig,
} from '../lib/ntripStorage';
import type { NtripFormState } from '../lib/types';

type UseNtripFormOptions = {
  /** Caster から取得済みの配信局一覧 */
  sourceTable: MountpointSummary[];
  /** 受信機の現在位置。最寄り局の並べ替えに使う */
  latitude?: number;
  longitude?: number;
};

/** 保存対象ではない項目の初期値 */
const TRANSIENT_DEFAULTS = {
  // パスワードは永続化しないため、常に既定値から始める
  password: DEFAULT_NTRIP_PASSWORD,
  isManualMountpoint: false,
};

/**
 * 配信局を並べ替える基準座標を丸める粒度（度）。緯度でおよそ 110 m に当たる。
 *
 * 受信機の座標は搬送波位相解のゆらぎだけで小数第 7 位まで動き続けるため、
 * そのまま並べ替えの入力にすると、静止していても毎回すべての配信局を測り直すことになる。
 * 選ぶのは数十 km の基線で使う基準局なので、この粒度で丸めても順位は変わらない。
 */
const RANKING_GRID_DEGREES = 0.001;

/** 並べ替えの基準に使う、丸めた座標。未測位なら null */
function toRankingCoordinate(value: number | undefined): number | null {
  if (value === undefined) return null;
  return Math.round(value / RANKING_GRID_DEGREES) * RANKING_GRID_DEGREES;
}

/**
 * NTRIP 接続設定フォームの状態・永続化・配信局の並べ替えをまとめたフック。
 *
 * フォームの実体は「保存済み設定 ＋ 画面での変更」。保存済み設定を `useState` の
 * 初期化子から読むとサーバー描画の結果と食い違ってハイドレーションが壊れるため、
 * localStorage は外部ストアとして {@link useSyncExternalStore} 経由で読む。
 */
export function useNtripForm({ sourceTable, latitude, longitude }: UseNtripFormOptions) {
  const stored = useSyncExternalStore(
    subscribeNtripConfig,
    getNtripConfigSnapshot,
    getServerNtripConfigSnapshot,
  );
  const [edits, setEdits] = useState<Partial<NtripFormState>>({});

  const form = useMemo<NtripFormState>(
    () => ({ ...TRANSIENT_DEFAULTS, ...stored, ...edits }),
    [stored, edits],
  );

  const update = useCallback((patch: Partial<NtripFormState>) => {
    setEdits((current) => ({ ...current, ...patch }));
  }, []);

  // 画面で変更された時点から保存する（パスワードは対象外）。
  // 変更前に保存すると、復元より先に既定値で上書きしてしまう
  const isEdited = Object.keys(edits).length > 0;
  useEffect(() => {
    if (!isEdited) return;
    saveNtripConfig({
      host: form.host,
      port: form.port,
      mountpoint: form.mountpoint,
      username: form.username,
      autoSelect: form.autoSelect,
    });
  }, [isEdited, form.host, form.port, form.mountpoint, form.username, form.autoSelect]);

  // 受信機の測位位置を基準に、近い配信局から順に並べる。
  // 丸めた座標を基準にすることで、測位が更新されるたびの並べ替えを避ける
  const rankingLatitude = toRankingCoordinate(latitude);
  const rankingLongitude = toRankingCoordinate(longitude);
  const candidates = useMemo(
    () => rankMountpoints(sourceTable, rankingLatitude, rankingLongitude),
    [sourceTable, rankingLatitude, rankingLongitude],
  );

  // 自動選択が有効なら最寄り局を採用する
  const activeMountpoint = useMemo(() => {
    if (form.autoSelect && !form.isManualMountpoint && candidates.length > 0) {
      return candidates[0]?.mountpoint || form.mountpoint;
    }
    return form.mountpoint;
  }, [form.autoSelect, form.isManualMountpoint, form.mountpoint, candidates]);

  return { form, update, candidates, activeMountpoint };
}
