# Takion CLAS / RTK Web Monitor

高精度測位モジュール「TakionCM001」専用の、ブラウザ完結型高精度測位モニターアプリケーションです。

Google Chrome などの **Web Serial API** 対応ブラウザから直接USBシリアルポートを開き、測位状況（CLAS / ネットワークRTK / 単独測位）や NMEA / UBX / RTCM 電文の解析ログをリアルタイムに表示します。

---

## 主な機能

1. **Web Serial 接続**
   - ブラウザから直接 TakionCM001 に接続。
   - ボーレート変更（9600 〜 460800 bps）対応。
   - NAV-PVT メッセージの有効化/無効化制御。

2. **2つの補正測位モード対応**
   - **CLAS モード (みちびき L6 衛星補正)**: 準天頂衛星「みちびき」からのセンチメートル級補正情報を利用。
   - **ネットワークRTK (NTRIP) モード**: NTRIP Caster (rtk2go.com, 各種キャスター等) から補正データ (RTCM) を取得し、受信機へ注入してRTK測位を実現。

3. **リアルタイムマップ & 衛星追跡**
   - MapLibre GL を使用した高精度測位位置・軌跡のリアルタイム表示。
   - GPS, QZSS (みちびき), GLONASS, Galileo, BeiDou 等の衛星配置・SNRのグラフィカル表示。

4. **電文ログビューア & リファレンス**
   - 受信した NMEA / UBX / RTCM 電文をリアルタイム解析して日本語で解説表示。
   - 電文辞書（リファレンスモーダル）による各プロトコルの詳細情報検索。

---

## ローカルでの起動手順

### 必要環境
- Node.js 20+ (推奨: Node 22+)
- Google Chrome, Microsoft Edge, または Web Serial API をサポートする Chromium 系ブラウザ

### 1. リポジトリのクローン
```bash
git clone https://github.com/futomi/takion-clas-rtk-web-monitor.git
cd takion-clas-rtk-web-monitor
```

### 2. 依存パッケージのインストール
```bash
npm install
```

### 3. アプリの起動
```bash
npm run dev
```
起動後、Web Serial API に対応したブラウザ（Google Chrome / Microsoft Edge 等）で [http://localhost:3000](http://localhost:3000) を開きます。

---

## ディレクトリ構成

- `app/` - Next.js App Router (UI コンポーネントおよび API ルート)
  - `page.tsx` - エントリーポイント
  - `MonitorClient.tsx` - メインUI & Web Serial 通信 / NTRIP 制御
  - `MapPanel.tsx` - 地図描画パネル (MapLibre GL)
  - `lib/gnssMessages.ts` - NMEA / UBX / RTCM 解析および解説辞書
  - `api/ntrip/` - NTRIP Sourcetable 取得 & RTCM ストリーミングプロキシ
- `public/` - 静的アセット (ファビコン, OGP画像)
