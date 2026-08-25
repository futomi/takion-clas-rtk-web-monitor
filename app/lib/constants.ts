/**
 * アプリ全体で共有する閾値・上限値の定義。
 * マジックナンバーを散在させないために、意味のある名前で一元管理する。
 */

// ---- 受信バッファ / フレーム解析 ----
/** NMEA センテンスとして受理する最大バイト長（`$` から改行手前まで） */
export const MAX_NMEA_BYTES = 256;
/** UBX ペイロードとして受理する最大バイト長。これを超える長さ表記は同期外れとみなす */
export const MAX_UBX_PAYLOAD_BYTES = 16384;

// ---- 単位換算 ----
/** ノット → km/h の換算係数。解析側と要約表示側の双方が同じ値を使う */
export const KNOTS_TO_KMH = 1.852;

// ---- 測位品質 ----
/**
 * NMEA の GGA が定める測位品質コード。
 * UBX の測位解もこの体系へ正規化して扱うため、アプリ全体で唯一の測位品質表現になる。
 */
export const GGA_QUALITY = {
  NO_FIX: 0,
  STANDALONE: 1,
  DGPS: 2,
  /** 搬送波位相が解けた cm 級測位。CLAS 由来か NTRIP 由来かはこのコードでは区別しない */
  PRECISE_FIX: 4,
  /** 搬送波位相が収束途中の測位 */
  PRECISE_FLOAT: 5,
  DEAD_RECKONING: 6,
} as const;

// ---- 衛星集計の有効期限 ----
/** GSV 由来の可視衛星エントリを保持する時間（ms）。これを過ぎたものは失探とみなす */
export const GSV_ENTRY_TTL_MS = 8000;
/** GSA 由来の使用衛星エントリを保持する時間（ms） */
export const GSA_ENTRY_TTL_MS = 5000;

// ---- 補正ソースのアクティブ判定 ----
/** 最後の RTCM 受信からこの時間内なら NTRIP 補正が生きているとみなす（ms） */
export const NTRIP_ACTIVE_WINDOW_MS = 10000;
/** 最後の L6 フレーム受信からこの時間内なら CLAS 補正が生きているとみなす（ms） */
export const L6_ACTIVE_WINDOW_MS = 12000;

// ---- ログ表示 ----
export const DEFAULT_MAX_LOGS = 250;
export const LOG_LIMIT_OPTIONS = [100, 250, 500, 1000] as const;
/** 端末表示の端からこの距離（px）以内なら「最新に追従中」とみなす */
export const AUTO_SCROLL_THRESHOLD_PX = 32;
/** 「コピーしました」表示を維持する時間（ms） */
export const COPY_FEEDBACK_DURATION_MS = 2000;
/** ログ種別チップに表示する電文種別の最大数 */
export const LOG_TYPE_CHIP_COUNT = 5;

// ---- 地図 ----
/** 地図エラーバナーを自動的に閉じるまでの時間（ms） */
export const MAP_ERROR_DURATION_MS = 4000;

// ---- 受信機 ----
export const UBLOX_VENDOR_ID = 0x1546;
export const BAUD_RATE_OPTIONS = [9600, 19200, 38400, 57600, 115200, 230400, 460800] as const;
export const DEFAULT_BAUD_RATE = 38400;
