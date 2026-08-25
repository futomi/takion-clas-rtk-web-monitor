export type MessageCategory = 'position' | 'satellite' | 'clas' | 'rtk' | 'system' | 'other';

export type GnssSystemKey = 'gps' | 'qzss' | 'galileo' | 'glonass' | 'beidou' | 'sbas' | 'other';

export type GnssSystemInfo = {
  key: GnssSystemKey;
  nameJa: string;
  nameEn: string;
  short: string;
};

export type SatelliteBreakdown = Partial<Record<GnssSystemKey, number>>;

export const GNSS_SYSTEMS: Record<GnssSystemKey, GnssSystemInfo> = {
  gps: { key: 'gps', nameJa: 'GPS', nameEn: 'GPS', short: 'GPS' },
  qzss: { key: 'qzss', nameJa: 'みちびき', nameEn: 'QZSS', short: 'QZS' },
  galileo: { key: 'galileo', nameJa: 'Galileo', nameEn: 'Galileo', short: 'GAL' },
  glonass: { key: 'glonass', nameJa: 'GLONASS', nameEn: 'GLONASS', short: 'GLO' },
  beidou: { key: 'beidou', nameJa: 'BeiDou', nameEn: 'BeiDou', short: 'BDS' },
  sbas: { key: 'sbas', nameJa: 'SBAS', nameEn: 'SBAS', short: 'SBA' },
  other: { key: 'other', nameJa: 'その他', nameEn: 'Other', short: 'OTH' },
};

export const GNSS_SYSTEM_ORDER: GnssSystemKey[] = ['gps', 'qzss', 'galileo', 'glonass', 'beidou', 'sbas', 'other'];

/**
 * Talker ID から衛星システムを特定
 */
export function getGnssSystemFromTalker(talker: string): GnssSystemKey {
  const t = talker.toUpperCase();
  if (t === 'GP') return 'gps';
  if (t === 'GQ' || t === 'QZ') return 'qzss';
  if (t === 'GA') return 'galileo';
  if (t === 'GL') return 'glonass';
  if (t === 'GB' || t === 'BD') return 'beidou';
  if (t === 'GI') return 'other';
  if (t === 'SB') return 'sbas';
  return 'other';
}

/**
 * NMEA 4.10+ の System ID (1-6) から衛星システムを特定
 */
export function getGnssSystemFromSystemId(systemId: number | string | undefined): GnssSystemKey | null {
  if (!systemId) return null;
  const id = Number(systemId);
  switch (id) {
    case 1: return 'gps';
    case 2: return 'glonass';
    case 3: return 'galileo';
    case 4: return 'beidou';
    case 5: return 'qzss';
    case 6: return 'other';
    default: return null;
  }
}

/**
 * PRN 番号と Talker / System ID から衛星システムを特定
 */
export function identifyGnssSystem(prn: number, talker?: string, systemId?: number | string): GnssSystemKey {
  const bySysId = getGnssSystemFromSystemId(systemId);
  if (bySysId) return bySysId;

  if (talker && talker !== 'GN') {
    return getGnssSystemFromTalker(talker);
  }

  if (prn >= 193 && prn <= 202) return 'qzss';
  if (prn >= 65 && prn <= 96) return 'glonass';
  if (prn >= 301 && prn <= 336) return 'galileo';
  if (prn >= 401 && prn <= 463) return 'beidou';
  if ((prn >= 33 && prn <= 64) || (prn >= 120 && prn <= 158)) return 'sbas';
  if (prn >= 1 && prn <= 32) return 'gps';

  return 'other';
}

export type FieldExplanation = {
  name: string;
  value?: string | number;
  description: string;
};

export type MessageDefinition = {
  type: string;
  titleJa: string;
  category: MessageCategory;
  categoryJa: string;
  summary: string;
  description: string;
  fields?: { name: string; description: string }[];
};


// ==========================================
// 1. NMEA 0183 辞書
// ==========================================
export const NMEA_DICTIONARY: Record<string, MessageDefinition> = {
  GGA: {
    type: 'GGA',
    titleJa: '基本測位・Fixデータ',
    category: 'position',
    categoryJa: '測位情報',
    summary: '現在位置(緯度経度)、標高、測位品質(Fix/Float/単独)、使用衛星数、HDOP',
    description: 'GNSS受信機の最も基本となる電文です。現在位置、海抜標高、測位品質（単独測位、DGPS、高精度RTK/CLAS Fix・Floatなど）、測位に使用した衛星数、ジオイド高などを毎秒送信します。',
    fields: [
      { name: 'UTC時刻', description: '測位時刻（hhmmss.ss）' },
      { name: '緯度・経度', description: '現在位置の座標（度分表記）' },
      { name: '測位品質 (Quality)', description: '0=未測位, 1=単独測位(3D FIX), 2=DGPS, 4=高精度Fix, 5=高精度Float' },
      { name: '使用衛星数', description: '現在の測位計算に直接使われている衛星の数' },
      { name: 'HDOP', description: '水平精度劣化係数（値が1.0以下だと非常に良好）' },
      { name: 'アンテナ標高', description: '平均海面（東京湾平均海面など）からの高さ(m)' },
      { name: 'ジオイド高', description: '楕円体高と標高の差（ジオイド高）' },
    ],
  },
  RMC: {
    type: 'RMC',
    titleJa: '推奨最小ナビゲーション情報',
    category: 'position',
    categoryJa: '測位・航法',
    summary: '測位ステータス(有効/無効)、緯度経度、対地移動速度、進行方位、年月日',
    description: 'ナビゲーションに必要な最小限の必須情報（位置、速度、方位、UTC日付・時刻）がひとまとめになった電文です。船舶や車両等の移動体追跡で標準的に使用されます。',
    fields: [
      { name: 'ステータス', description: 'A=有効 (Valid), V=警告・無効 (Invalid)' },
      { name: '対地速度', description: '移動速度（ノット単位）' },
      { name: '進行方位 (Course)', description: '真北を基準とした進行方向（度）' },
      { name: '日付 (Date)', description: 'UTC日付（ddmmyy）' },
    ],
  },
  GSA: {
    type: 'GSA',
    titleJa: '衛星配置・精度劣化係数 (DOP)',
    category: 'satellite',
    categoryJa: '衛星・精度',
    summary: '測位モード(2D/3D)、測位に使用中の衛星PRN番号一覧、PDOP / HDOP / VDOP',
    description: '測位の次元（2D測位または3D測位）と、測位演算に採用されている衛星の識別番号（PRN）、幾何学的な衛星配置から計算される精度低下率（DOP値）を伝えます。',
    fields: [
      { name: 'モード', description: 'M=手動, A=自動2D/3D切替 / 1=未測位, 2=2D測位, 3=3D測位' },
      { name: '使用衛星ID', description: '測位計算に参加している衛星のPRN/スロット番号' },
      { name: 'PDOP', description: '3次元位置精度劣化係数（総合的な衛星配置の良さ）' },
      { name: 'HDOP', description: '水平方向の精度劣化係数' },
      { name: 'VDOP', description: '垂直（高さ）方向の精度劣化係数' },
    ],
  },
  GSV: {
    type: 'GSV',
    titleJa: '可視衛星情報 (仰角・方位・電波強度)',
    category: 'satellite',
    categoryJa: '衛星・電波',
    summary: '上空に見えている全衛星の数、各衛星の仰角・方位角、信号強度 (C/N0 dB-Hz)',
    description: '受信機の上空にある可視衛星の数と、それぞれの衛星番号、仰角、方位角、受信信号強度（Carrier-to-Noise比: C/N0）を報告します。マルチGNSSではGPS(GP), GLONASS(GL), Galileo(GA), QZSS(GQ), BeiDou(GB)ごとに複数行で出力されます。',
    fields: [
      { name: 'メッセージ総数 / 番号', description: '全何メッセージ中の何番目か' },
      { name: '可視衛星総数', description: '現在受信機が捕捉・探索している衛星の総数' },
      { name: '衛星PRN番号', description: '衛星の識別番号' },
      { name: '仰角 (Elevation)', description: '地平線を0度、天頂を90度とした角度' },
      { name: '方位角 (Azimuth)', description: '真北を0度とした時計回りの角度(0〜359度)' },
      { name: 'C/N0 (信号強度)', description: '搬送波対雑音比（35〜50 dB-Hz程度で良好）' },
    ],
  },
  GST: {
    type: 'GST',
    titleJa: '擬似距離・測位誤差統計情報',
    category: 'position',
    categoryJa: '誤差統計',
    summary: '緯度・経度・高度の推定標準偏差誤差(m)、誤差楕円長軸・短軸パラメータ',
    description: 'カルマンフィルタ等の計算に基づく各軸（緯度、経度、高さ）の推定誤差（標準偏差 1-sigma）をメートル単位で報告します。cm級高精度測位の収束状況や信頼度の判定に用いられます。',
    fields: [
      { name: 'RMS誤差', description: '擬似距離残差の二乗平均平方根(m)' },
      { name: '緯度誤差 (Lat Sigma)', description: '緯度方向の推定標準偏差 (m)' },
      { name: '経度誤差 (Lon Sigma)', description: '経度方向の推定標準偏差 (m)' },
      { name: '高度誤差 (Alt Sigma)', description: '垂直方向の推定標準偏差 (m)' },
    ],
  },
  VTG: {
    type: 'VTG',
    titleJa: '対地進路・速度',
    category: 'position',
    categoryJa: '測位・航法',
    summary: '対地進路(真方位/磁方位)、対地移動速度(ノット & km/h)',
    description: 'ドップラー効果や位置差分から計算された実際の移動方向（進行ベクトルの方位）と対地移動速度をノットおよびkm/hで提供します。',
    fields: [
      { name: '真方位進路', description: '真北基準の進行方向（度）' },
      { name: '対地速度 (km/h)', description: '時速キロメートル' },
      { name: '対地速度 (Knots)', description: 'ノット単位の速度' },
    ],
  },
  ZDA: {
    type: 'ZDA',
    titleJa: 'UTC日時・タイムゾーン',
    category: 'system',
    categoryJa: '日時情報',
    summary: '原子時計基準のUTC時刻（時分秒）、年月日、ローカルタイムゾーンオフセット',
    description: 'GNSS衛星の高精度な原子時計から復号されたUTC（協定世界時）の年月日および時分秒を提供します。システムの高精度な時計合わせに利用されます。',
    fields: [
      { name: 'UTC時刻', description: '時:分:秒.ミリ秒' },
      { name: '年月日', description: '日、月、年（4桁）' },
    ],
  },
  GLL: {
    type: 'GLL',
    titleJa: '地理的位置 (緯度・経度)',
    category: 'position',
    categoryJa: '測位情報',
    summary: '緯度・経度・測位時刻・ステータス',
    description: '測位された緯度・経度と時刻のみを含むシンプルな電文です。',
  },
  TXT: {
    type: 'TXT',
    titleJa: '受信機システム通知テキスト',
    category: 'system',
    categoryJa: 'システム',
    summary: 'アンテナ接続状態、ファームウェア起動通知、設定警告メッセージなど',
    description: '受信機の内部状態（アンテナショート・オープン検知、ファームウェアバージョン、GNSS設定変更の通知など）を文字列で報告します。',
  },
};

// ==========================================
// 2. UBX (u-blox Binary Protocol) 辞書
// ==========================================
export const UBX_DICTIONARY: Record<string, MessageDefinition> = {
  PVT: {
    type: 'PVT (UBX-NAV-PVT)',
    titleJa: 'UBX高精度 航法測位・速度解',
    category: 'position',
    categoryJa: 'UBX測位解',
    summary: 'Fix/Float状態、3D座標、楕円体高/標高、mm級推定精度、対地速度、PDOP',
    description: 'u-blox受信機（F9P等）の中核となる高精度測位電文です。NMEAよりも高レート・高精度（緯度経度小数点以下7桁、ミリメートル単位の精度推定値）で完全な測位・速度・時刻解を出力します。',
    fields: [
      { name: 'Fix Type', description: '0=未測位, 2=2D, 3=3D, 4=GNSS+推測航法' },
      { name: 'Carrier Solution', description: '0=なし, 1=高精度Float (収束中), 2=高精度Fix (cm級達成)' },
      { name: '緯度・経度', description: '1e-7度単位の高精度測地座標' },
      { name: '水平/垂直 推定誤差', description: 'カルマンフィルタによるリアルタイム推定精度 (mm)' },
      { name: '対地速度 / 進行方位', description: '3次元速度ベクトルおよび進行方向' },
      { name: 'PDOP', description: '高分解能な精度低下係数' },
    ],
  },
  QZSSL6: {
    type: 'QZSSL6 (UBX-RXM-QZSSL6)',
    titleJa: 'みちびき CLAS / L6 補正フレーム',
    category: 'clas',
    categoryJa: 'CLAS補正',
    summary: '準天頂衛星「みちびき」L6D/L6E信号フレーム、衛星ID、受信電波強度 (C/N0)',
    description: '日本の準天頂衛星「みちびき（QZSS）」がL6周波数帯（1278.75MHz）で放送しているセンチメータ級測位補正データ（CLAS: Centimeter Level Augmentation Service）の受信フレームです。完全な地上通信なし（オフライン）でcm級測位を実現します。',
    fields: [
      { name: 'Signal Type', description: 'L6D (CLAS補正サービス) または L6E (MADOCA-PPP/実証用)' },
      { name: 'SV ID', description: '配信中のみちびき衛星番号 (例: 194, 195, 196, 199)' },
      { name: 'C/N0 (信号強度)', description: 'L6帯の電波受信強度（38 dBHz以上で安定受信）' },
    ],
  },
  'CFG-VALGET': {
    type: 'CFG-VALGET',
    titleJa: 'UBX 設定値照会応答',
    category: 'system',
    categoryJa: '設定・制御',
    summary: '受信機のコンフィグレーション（出力レートやポート設定）の照会結果',
    description: '受信機に対して要求した設定項目（ボーレート、メッセージ出力頻度、CLAS/RTK設定など）の現在の設定値を返します。',
  },
  'ACK-ACK': {
    type: 'ACK-ACK',
    titleJa: 'UBX コマンド受付完了 (Success)',
    category: 'system',
    categoryJa: '設定・制御',
    summary: '受信機が送信された設定コマンドを正常に受理・適用したことを通知',
    description: 'ホスト側から受信機へ送ったUBX-CFG設定コマンドが正しく解釈され、正常に適用されたことを示す肯定応答（ACK）です。',
  },
  'ACK-NAK': {
    type: 'ACK-NAK',
    titleJa: 'UBX コマンド拒否 (Error)',
    category: 'system',
    categoryJa: '設定・制御',
    summary: '送信されたコマンドまたは設定値が受信機によって拒否されたことを通知',
    description: '指定したキーやパラメータが無効、あるいは現在の動作モードで受け付けられない場合に受信機から返される否定応答（NAK）です。',
  },
  SIG: {
    type: 'SIG (UBX-NAV-SIG)',
    titleJa: 'UBX 信号追跡詳細',
    category: 'satellite',
    categoryJa: '信号追跡',
    summary: '各衛星の受信周波数帯 (L1C/A, L2C, L5, E1, E5b, L6等) と追跡品質',
    description: '受信機が現在追跡している全GNSS信号の周波数帯別ステータス、キャリア位相ロック状態、C/N0、疑似距離修正状況を伝えます。',
  },
  STATUS: {
    type: 'STATUS (UBX-NAV-STATUS)',
    titleJa: 'UBX 測位状態フラグ',
    category: 'position',
    categoryJa: 'UBX測位解',
    summary: '測位エンジン状態、TTFF（初回収束時間）、稼働時間',
    description: '測位エンジンの起動状態、初回収束にかかった時間、測位補正フラグなどを提供します。',
  },
};

// ==========================================
// 3. RTCM 3.x 辞書 (ネットワークRTK)
// ==========================================
export const RTCM_DICTIONARY: Record<string, MessageDefinition> = {
  RTCM1005: {
    type: 'RTCM 1005',
    titleJa: 'RTK 基準局アンテナ座標 (ARP)',
    category: 'rtk',
    categoryJa: 'RTK補正',
    summary: '配信基準局（Base Station）の固定3次元基準点座標 (ECEF-XYZ)',
    description: 'ネットワークRTKの配信基準局（アンテナ参照点: ARP）のミリメートル単位の高精度な3次元直交座標（ITRF/WGS84）です。移動局（Rover）はこの座標を原点として相対測位を行います。',
  },
  RTCM1006: {
    type: 'RTCM 1006',
    titleJa: 'RTK 基準局アンテナ座標＋アンテナ高',
    category: 'rtk',
    categoryJa: 'RTK補正',
    summary: '基準局の3次元座標およびアンテナ基準点からの高さ (m)',
    description: 'RTCM 1005の内容に加え、地上基準点からアンテナ位相中心までの設置高を含めた電文です。',
  },
  RTCM1074: {
    type: 'RTCM 1074',
    titleJa: 'GPS 観測データ (MSM4)',
    category: 'rtk',
    categoryJa: 'RTK補正',
    summary: 'GPS衛星のコード擬似距離・キャリア位相・CNR (通常精度)',
    description: 'GPS衛星群のマルチシグナル観測データ（MSM4形式）です。RTK測位の整数値バイアス決定に必要な搬送波位相データを提供します。',
  },
  RTCM1077: {
    type: 'RTCM 1077',
    titleJa: 'GPS 高精度観測データ (MSM7)',
    category: 'rtk',
    categoryJa: 'RTK補正',
    summary: 'GPS衛星の最高分解能コード擬似距離・高精度キャリア位相・ドップラー・CNR',
    description: 'GPS衛星群の最高精度拡張観測データ（MSM7形式）です。ミリメートル級の位相分解能と高レートなドップラー情報を含み、高速なRTK Fixに最適です。',
  },
  RTCM1084: {
    type: 'RTCM 1084',
    titleJa: 'GLONASS 観測データ (MSM4)',
    category: 'rtk',
    categoryJa: 'RTK補正',
    summary: 'GLONASS（ロシア）衛星群の観測データ (MSM4)',
    description: 'GLONASS衛星群の擬似距離およびキャリア位相観測情報です。',
  },
  RTCM1087: {
    type: 'RTCM 1087',
    titleJa: 'GLONASS 高精度観測データ (MSM7)',
    category: 'rtk',
    categoryJa: 'RTK補正',
    summary: 'GLONASS（ロシア）衛星群の高精度観測データ (MSM7)',
    description: 'GLONASS衛星群の最高分解能マルチシグナル観測データです。',
  },
  RTCM1094: {
    type: 'RTCM 1094',
    titleJa: 'Galileo 観測データ (MSM4)',
    category: 'rtk',
    categoryJa: 'RTK補正',
    summary: 'Galileo（欧州）衛星群の観測データ (MSM4)',
    description: '欧州Galileo衛星群の擬似距離およびキャリア位相観測情報です。',
  },
  RTCM1097: {
    type: 'RTCM 1097',
    titleJa: 'Galileo 高精度観測データ (MSM7)',
    category: 'rtk',
    categoryJa: 'RTK補正',
    summary: 'Galileo（欧州）衛星群の高精度観測データ (MSM7)',
    description: '欧州Galileo衛星群の最高分解能マルチシグナル観測データです。',
  },
  RTCM1114: {
    type: 'RTCM 1114',
    titleJa: 'QZSS (みちびき) 観測データ (MSM4)',
    category: 'rtk',
    categoryJa: 'RTK補正',
    summary: '準天頂衛星「みちびき」の観測データ (MSM4)',
    description: '日本上空の準天頂衛星（QZSS）の観測情報です。ビル街や山間部でのRTK可用性を高めます。',
  },
  RTCM1117: {
    type: 'RTCM 1117',
    titleJa: 'QZSS (みちびき) 高精度観測データ (MSM7)',
    category: 'rtk',
    categoryJa: 'RTK補正',
    summary: '準天頂衛星「みちびき」の最高分解能観測データ (MSM7)',
    description: '準天頂衛星「みちびき」の高精度拡張観測データです。',
  },
  RTCM1124: {
    type: 'RTCM 1124',
    titleJa: 'BeiDou 観測データ (MSM4)',
    category: 'rtk',
    categoryJa: 'RTK補正',
    summary: 'BeiDou（中国）衛星群の観測データ (MSM4)',
    description: '中国BeiDou衛星群の擬似距離およびキャリア位相観測情報です。',
  },
  RTCM1127: {
    type: 'RTCM 1127',
    titleJa: 'BeiDou 高精度観測データ (MSM7)',
    category: 'rtk',
    categoryJa: 'RTK補正',
    summary: 'BeiDou（中国）衛星群の高精度観測データ (MSM7)',
    description: '中国BeiDou衛星群の最高分解能マルチシグナル観測データです。',
  },
  RTCM1033: {
    type: 'RTCM 1033',
    titleJa: '基準局・アンテナ記述子 (Descriptor)',
    category: 'rtk',
    categoryJa: 'RTK補正',
    summary: '基準局の受信機型番、アンテナ型番、シリアル番号、ファームウェア情報',
    description: '基準局で使用されているアンテナの型式（位相中心校正値の適用に必要）や受信機の機種情報を提供します。',
  },
  RTCM1230: {
    type: 'RTCM 1230',
    titleJa: 'GLONASS コード・位相バイアス',
    category: 'rtk',
    categoryJa: 'RTK補正',
    summary: 'GLONASS周波数間バイアス補正情報',
    description: 'FDMA方式を採用するGLONASS衛星の受信機固有ハードウェアバイアスを補正し、異機種間RTKのFix率を向上させます。',
  },
};

// ==========================================
// 4. メッセージ解説取得ヘルパー関数
// ==========================================

export function getMessageDefinition(type: string): MessageDefinition {
  // NMEA
  if (NMEA_DICTIONARY[type]) {
    return NMEA_DICTIONARY[type];
  }

  // UBX
  if (UBX_DICTIONARY[type]) {
    return UBX_DICTIONARY[type];
  }

  // RTCM
  if (RTCM_DICTIONARY[type]) {
    return RTCM_DICTIONARY[type];
  }

  // RTCM汎用マッチ (例: RTCM1075)
  if (type.startsWith('RTCM')) {
    const numStr = type.replace('RTCM', '');
    const num = Number(numStr);
    if (num >= 1071 && num <= 1077) {
      return {
        type,
        titleJa: `GPS 観測データ (${type})`,
        category: 'rtk',
        categoryJa: 'RTK補正',
        summary: `GPS衛星群の観測データ (MSM${num % 10})`,
        description: 'GPS衛星群のコード擬似距離・キャリア位相観測情報です。',
      };
    }
    if (num >= 1081 && num <= 1087) {
      return {
        type,
        titleJa: `GLONASS 観測データ (${type})`,
        category: 'rtk',
        categoryJa: 'RTK補正',
        summary: `GLONASS衛星群の観測データ (MSM${num % 10})`,
        description: 'GLONASS衛星群の観測情報です。',
      };
    }
    if (num >= 1091 && num <= 1097) {
      return {
        type,
        titleJa: `Galileo 観測データ (${type})`,
        category: 'rtk',
        categoryJa: 'RTK補正',
        summary: `Galileo衛星群の観測データ (MSM${num % 10})`,
        description: 'Galileo衛星群の観測情報です。',
      };
    }
    if (num >= 1111 && num <= 1117) {
      return {
        type,
        titleJa: `QZSS (みちびき) 観測データ (${type})`,
        category: 'rtk',
        categoryJa: 'RTK補正',
        summary: `みちびき衛星群の観測データ (MSM${num % 10})`,
        description: '準天頂衛星みちびきの観測情報です。',
      };
    }
    if (num >= 1121 && num <= 1127) {
      return {
        type,
        titleJa: `BeiDou 観測データ (${type})`,
        category: 'rtk',
        categoryJa: 'RTK補正',
        summary: `BeiDou衛星群の観測データ (MSM${num % 10})`,
        description: 'BeiDou衛星群の観測情報です。',
      };
    }
    return {
      type,
      titleJa: `RTCM3 補正データ (${type})`,
      category: 'rtk',
      categoryJa: 'RTK補正',
      summary: `RTCM3 補正メッセージ (ID ${numStr || '不明'})`,
      description: 'ネットワークRTKで受信された基準局からのバイナリ補正メッセージです。',
    };
  }

  // デフォルト（未知のメッセージ）
  return {
    type,
    titleJa: `${type} 電文`,
    category: 'other',
    categoryJa: 'その他',
    summary: `${type} フォーマットの受信電文`,
    description: '受信機または補正ソースから受信されたデータフレームです。',
  };
}

/**
 * NMEAセンテンスの生文字列から、人間が直感的に読める日本語の要約テキストを生成
 */
export function formatNmeaSummary(type: string, rawLine: string): string {
  const parts = rawLine.replace(/\*[0-9A-Fa-f]{2}$/, '').split(',');
  switch (type) {
    case 'GGA': {
      const q = parts[6];
      const qText = q === '4' ? '高精度Fix' : q === '5' ? '高精度Float' : q === '1' ? '単独測位' : q === '2' ? 'DGPS' : '未測位';
      const svs = parts[7] ? `${parts[7]}機` : '';
      const hdop = parts[8] ? `HDOP ${parts[8]}` : '';
      const alt = parts[9] ? `標高 ${parts[9]}m` : '';
      return [qText, svs, hdop, alt].filter(Boolean).join(' · ');
    }
    case 'RMC': {
      const status = parts[2] === 'A' ? '有効' : '無効';
      const speedKnots = Number(parts[7]);
      const speedKmh = Number.isFinite(speedKnots) ? `${(speedKnots * 1.852).toFixed(1)} km/h` : '';
      const course = parts[8] ? `方位 ${Number(parts[8]).toFixed(1)}°` : '';
      return [`状態: ${status}`, speedKmh, course].filter(Boolean).join(' · ');
    }
    case 'GSA': {
      const mode = parts[2] === '3' ? '3D測位' : parts[2] === '2' ? '2D測位' : '未測位';
      const pdop = parts[15] ? `PDOP ${parts[15]}` : '';
      return [`モード: ${mode}`, pdop].filter(Boolean).join(' · ');
    }
    case 'GSV': {
      const talker = parts[0]?.slice(1, 3) || 'GN';
      const talkerName = talker === 'GP' ? 'GPS' : talker === 'GL' ? 'GLONASS' : talker === 'GA' ? 'Galileo' : talker === 'GQ' || talker === 'QZ' ? 'みちびき(QZSS)' : talker === 'GB' || talker === 'BD' ? 'BeiDou' : 'GNSS';
      const totalSvs = parts[3] ? `可視 ${parts[3]}機` : '';
      const msgNum = parts[2] && parts[1] ? `(${parts[2]}/${parts[1]})` : '';
      return [`${talkerName} ${totalSvs} ${msgNum}`].filter(Boolean).join(' · ');
    }
    case 'GST': {
      const latSigma = parts[6] ? `緯度±${Number(parts[6]).toFixed(3)}m` : '';
      const lonSigma = parts[7] ? `経度±${Number(parts[7]).toFixed(3)}m` : '';
      const altSigma = parts[8] ? `高度±${Number(parts[8]).toFixed(3)}m` : '';
      return [latSigma, lonSigma, altSigma].filter(Boolean).join(' · ');
    }
    case 'VTG': {
      const course = parts[1] ? `進行方位 ${parts[1]}°` : '';
      const kmh = parts[7] ? `${parts[7]} km/h` : '';
      return [course, kmh].filter(Boolean).join(' · ');
    }
    case 'ZDA': {
      const time = parts[1] ? `${parts[1].slice(0, 2)}:${parts[1].slice(2, 4)}:${parts[1].slice(4, 6)} UTC` : '';
      const date = parts[4] && parts[3] && parts[2] ? `${parts[4]}-${parts[3]}-${parts[2]}` : '';
      return [date, time].filter(Boolean).join(' ');
    }
    default:
      return '';
  }
}

/**
 * 全辞書エントリーをカテゴリ別に整理して返す（リファレンスモーダル用）
 */
export function getAllMessageDefinitions(): MessageDefinition[] {
  return [
    ...Object.values(NMEA_DICTIONARY),
    ...Object.values(UBX_DICTIONARY),
    ...Object.values(RTCM_DICTIONARY),
  ];
}
