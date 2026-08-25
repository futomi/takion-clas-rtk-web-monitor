import {
  CFG_KEY_MSGOUT_NAV_PVT_USB,
  DISABLE_NAV_PVT_USB_RAM,
  ENABLE_NAV_PVT_USB_RAM,
  GET_NAV_PVT_USB_RATE,
  UBX_CLASS,
  UBX_ID,
  readAckTarget,
  readValgetByte,
} from './ubx';

/** ネゴシエータが外界へ触れるための口。テストではここを差し替える */
export type PvtOutputNegotiatorPorts = {
  /** 受信機への書き込み経路が使える状態かを返す */
  canWrite: () => boolean;
  /** 受信機へ UBX フレームを送る */
  write: (frame: Uint8Array) => Promise<void>;
  /** 利用者へ見せるエラーメッセージを通知する */
  onError: (message: string) => void;
};

/**
 * 受信機の NAV-PVT 出力を、必要な場合にだけ一時的に有効化する交渉役。
 *
 * 手順は「現在の出力レートを照会 → 応答と ACK が揃うのを待つ → 元が無効（0）だった
 * ときだけ RAM 層で有効化」。既に NAV-PVT を出している受信機の設定には一切触れない。
 * 有効化した場合は切断時に {@link restore} で必ず元へ戻す。
 *
 * 応答は照会結果（CFG-VALGET）と受理通知（ACK-ACK）が別フレームで、到着順も保証されない。
 * そのため両方が揃ったことを状態として持ち、揃った時点で一度だけ有効化を撃つ。
 */
export class PvtOutputNegotiator {
  /** 受信機が元々持っていた NAV-PVT 出力レート。照会応答を受け取るまでは null */
  private originalRate: number | null = null;
  private valgetReplyReceived = false;
  private valgetAckReceived = false;
  private enableRequested = false;
  /** 自分が有効化したか。切断時に元へ戻すべきかの判断に使う */
  private temporaryOutputEnabled = false;

  private readonly ports: PvtOutputNegotiatorPorts;

  // Node のテストランナーは型注釈を落とすだけなので、
  // パラメータプロパティ（constructor(private ports: …)）は使えない
  constructor(ports: PvtOutputNegotiatorPorts) {
    this.ports = ports;
  }

  /** 接続直後に呼ぶ。現在の NAV-PVT 出力レートを受信機へ照会する */
  async start(): Promise<void> {
    await this.ports.write(GET_NAV_PVT_USB_RATE);
  }

  /** 受信した UBX フレームを 1 件渡す。設定応答でなければ何も起きない */
  handleFrame(frame: Uint8Array): void {
    if (this.originalRate === null) {
      const rate = readValgetByte(frame, CFG_KEY_MSGOUT_NAV_PVT_USB);
      if (rate !== null) {
        this.originalRate = rate;
        this.valgetReplyReceived = true;
        this.enableIfReady();
      }
    }

    const ack = readAckTarget(frame);
    if (!ack || ack.targetClass !== UBX_CLASS.CFG) return;

    if (ack.targetId === UBX_ID.CFG_VALGET) {
      if (ack.accepted) {
        this.valgetAckReceived = true;
        this.enableIfReady();
      } else {
        this.ports.onError('受信機が測位データ出力設定の照会を拒否しました。接続先のUSBポートを確認してください。');
      }
    }

    if (ack.targetId === UBX_ID.CFG_VALSET && !ack.accepted) {
      this.temporaryOutputEnabled = false;
      this.ports.onError('受信機が測位データ出力の開始設定を拒否しました。');
    }
  }

  /** 一時的に有効化した出力を元へ戻す。自分で有効化していなければ何もしない */
  async restore(): Promise<void> {
    if (!this.temporaryOutputEnabled || !this.ports.canWrite()) return;
    await this.ports.write(DISABLE_NAV_PVT_USB_RAM);
    this.temporaryOutputEnabled = false;
  }

  /** 交渉の途中経過をすべて捨てる。再接続時に呼ぶ */
  reset(): void {
    this.originalRate = null;
    this.valgetReplyReceived = false;
    this.valgetAckReceived = false;
    this.enableRequested = false;
    this.temporaryOutputEnabled = false;
  }

  /** 元へ戻すべき設定変更を抱えているか。交渉結果を外から観測する唯一の口 */
  get hasTemporaryOutput(): boolean {
    return this.temporaryOutputEnabled;
  }

  /**
   * 照会応答と ACK が揃い、かつ元の出力レートが 0（＝無効）だった場合にだけ有効化する。
   * 既に出力している受信機の設定は触らない。
   */
  private enableIfReady(): void {
    if (
      this.originalRate !== 0
      || !this.valgetReplyReceived
      || !this.valgetAckReceived
      || this.enableRequested
      || !this.ports.canWrite()
    ) return;

    this.enableRequested = true;
    this.temporaryOutputEnabled = true;
    void this.ports.write(ENABLE_NAV_PVT_USB_RAM).catch((error: unknown) => {
      this.enableRequested = false;
      this.temporaryOutputEnabled = false;
      this.ports.onError(error instanceof Error ? error.message : '測位データ出力を開始できませんでした。');
    });
  }
}
