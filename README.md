# Takion CLAS / RTK Web Monitor

高精度測位モジュール「[TakionCM001](https://store.shopping.yahoo.co.jp/tamaki-syouji/takion2022-001.html)」専用の、ブラウザ完結型高精度測位モニターアプリケーションです。

<img src="docs/images/takioncm001.jpg" alt="TakionCM001" width="450" />

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
- **ハードウェア**: [TakionCM001](https://store.shopping.yahoo.co.jp/tamaki-syouji/takion2022-001.html) 本体、対応アンテナ、USBケーブル
- **ソフトウェア**: Node.js 20+ (推奨: Node 22+)
- **ブラウザ**: Google Chrome, Microsoft Edge 等の Web Serial API 対応ブラウザ

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

### 4. TakionCM001 の接続と利用
1. TakionCM001 にアンテナを接続し、USB ケーブルで PC に接続します。
2. ブラウザで [http://localhost:3000](http://localhost:3000) を開きます。
3. 画面左上の「接続」ボタンをクリックします。
4. ブラウザのポート選択ダイアログが表示されるので、TakionCM001 のデバイス（例: `u-blox GNSS receiver` や `USB シリアル デバイス` 等）を選択して「接続」をクリックすると、リアルタイムモニターが開始されます。

