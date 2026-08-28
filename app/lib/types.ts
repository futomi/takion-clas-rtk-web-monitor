import type { MessageCategory } from './messageDictionary';
import type { Telemetry } from './telemetry';

/** GSV（可視衛星）電文から抽出した集計対象データ */
export type GsvReport = {
  talker: string;
  /** 電文に列挙されていた PRN。ページによっては空になり得る */
  prns: number[];
  /** 電文が申告する可視衛星総数。PRN が取れない場合のフォールバックに使う */
  totalInView?: number;
};

/** GSA（使用衛星）電文から抽出した集計対象データ */
export type GsaReport = {
  talker: string;
  systemId?: number;
  prns: number[];
};

/** 1 電文の解析結果。プロトコルによらず共通の形に正規化する */
export type ParsedMessage = {
  /** 'GGA' / 'PVT' / 'RTCM1005' など、辞書引きのキーになる電文種別 */
  type: string;
  /** チェックサム検証結果。検証対象外の場合は null */
  valid: boolean | null;
  /** この電文から得られたテレメトリの差分 */
  update: Partial<Telemetry>;
  /** 人間向けの 1 行要約。未設定なら辞書の既定要約を使う */
  summary?: string;
  gsv?: GsvReport;
  gsa?: GsaReport;
};

/** 受信ログの 1 行 */
export type LogLine = {
  id: number;
  receivedAt: number;
  /** 生テキスト（NMEA）または人間可読なフレーム要約（UBX / RTCM） */
  rawText: string;
  type: string;
  valid: boolean | null;
  titleJa: string;
  category: MessageCategory;
  categoryJa: string;
  /** この電文が実際に何を伝えているかの日本語要約 */
  meaning: string;
};

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnecting';
export type CorrectionMode = 'clas' | 'ntrip' | 'none';
export type NtripStatus = 'idle' | 'connecting' | 'connected' | 'error';

/**
 * ネットワーク RTK をどこまで提供するか。ビルド時に決まる。
 *
 * - `none`: 中継 API が成果物に含まれない（静的書き出し）。どこから開いても提供できない
 * - `loopback`: 既定。ローカルから開いたときだけ提供する
 * - `always`: `NTRIP_ENABLED=true`。中継を意図して立てる場合
 */
export type NtripAvailability = 'none' | 'loopback' | 'always';

/**
 * NTRIP クライアントのうち、設定パネルが描画に使う部分だけを切り出した形。
 * パネルへ接続操作そのものを渡さないため、接続の開始・停止はコールバック経由に限られる。
 */
export type NtripLiveState = {
  status: NtripStatus;
  error: string;
  isFetchingSources: boolean;
  bytesReceived: number;
  rateKbps: number;
  lastDataAt: number | null;
};

/**
 * NTRIP 接続設定フォームの入力内容。
 *
 * 状態を持つのは {@link ../hooks/useNtripForm} で、描画するのは NtripConfigPanel。
 * どちらか一方に型を置くと他方が相手を import することになるため、共通の定義元をここに置く。
 */
export type NtripFormState = {
  host: string;
  port: number;
  mountpoint: string;
  username: string;
  password: string;
  autoSelect: boolean;
  /** マウントポイントをリスト選択ではなく手入力しているか */
  isManualMountpoint: boolean;
};

export type LogDisplayMode = 'explained' | 'summary' | 'raw';
export type LogCategoryFilter = 'all' | MessageCategory;
