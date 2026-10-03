import {
  CFG_KEY_MSGOUT_NAV_PVT_USB,
  CFG_KEY_RATE_MEAS,
  UBX_CLASS,
  UBX_ID,
  buildValgetRequest,
  buildValsetRequest,
  readAckTarget,
  readValgetValues,
  type CfgItem,
} from './ubx';

/** ネゴシエータが外界へ触れるための口。テストではここを差し替える */
export type ReceiverConfigPorts = {
  /** 受信機への書き込み経路が使える状態かを返す */
  canWrite: () => boolean;
  /** 受信機へ UBX フレームを送る */
  write: (frame: Uint8Array) => Promise<void>;
  /** 利用者へ見せるエラーメッセージを通知する */
  onError: (message: string) => void;
};

/** ACK / NAK を待っている書き込み。拒否されたときの後始末が書いた中身で変わる */
type PendingWrite = { kind: 'enable-pvt' | 'set-rate' };

/**
 * 受信機の設定を、接続している間だけ書き換える交渉役。
 *
 * 扱うのは次の 2 つ。
 * - NAV-PVT の USB 出力: 元が無効（0）だったときだけ有効化する。既に出している受信機には触れない。
 * - 測位の間隔（CFG-RATE-MEAS）: 画面で選んだ値が元の値と違えば書き換える。接続中に選び直しても追従する。
 *
 * 手順は「今の値を照会 → 応答と ACK が揃うのを待つ → 必要なものだけ RAM 層へ書く」。
 * 書き換えたものは切断時に {@link restore} で必ず元の値へ戻す。
 *
 * 照会の応答は照会結果（CFG-VALGET）と受理通知（ACK-ACK）が別フレームで、到着順も保証されない。
 * そのため両方が揃ったことを状態として持ち、揃った時点で一度だけ書き込みを始める。
 *
 * 書き込み（CFG-VALSET）への ACK / NAK は、どの書き込みへの応答かまでは名乗らない。
 * 受信機は届いた順に応答を返すので、応答待ちの書き込みを送った順に控えておき、先頭から割り当てる。
 * 2 つの設定を別々の交渉役に分けないのはこのためで、分けると互いの応答を取り違える。
 */
export class ReceiverConfigNegotiator {
  /** 受信機が元々持っていた NAV-PVT 出力レート。照会応答を受け取るまで（または応答に無ければ）null */
  private originalPvtRate: number | null = null;
  /** 受信機が元々持っていた測位間隔（ms）。同上 */
  private originalPeriodMs: number | null = null;
  private valgetReplyReceived = false;
  private valgetAckReceived = false;
  /** 照会が揃い、書き込みを始めたか */
  private negotiated = false;
  /** 切断の後始末に入ったか。ここから先は何も書き換えない */
  private closing = false;
  /** 自分が NAV-PVT 出力を有効化したか。切断時に元へ戻すべきかの判断に使う */
  private temporaryOutputEnabled = false;
  /** 受信機へ最後に書いた測位間隔（ms）。書いていなければ元の値。拒否されて分からなくなったら null */
  private appliedPeriodMs: number | null = null;
  /** 測位間隔を書き換えたか。切断時に元へ戻すべきかの判断に使う */
  private periodChanged = false;
  private pendingWrites: PendingWrite[] = [];
  /** 画面で選ばれている測位間隔（ms）。接続をまたいで持ち越す */
  private desiredPeriodMs: number;

  private readonly ports: ReceiverConfigPorts;

  // Node のテストランナーは型注釈を落とすだけなので、
  // パラメータプロパティ（constructor(private ports: …)）は使えない
  constructor(ports: ReceiverConfigPorts, desiredPeriodMs: number) {
    this.ports = ports;
    this.desiredPeriodMs = desiredPeriodMs;
  }

  /** 接続直後に呼ぶ。NAV-PVT の出力レートと測位間隔を 1 回の照会で尋ねる */
  async start(): Promise<void> {
    await this.ports.write(buildValgetRequest([CFG_KEY_MSGOUT_NAV_PVT_USB, CFG_KEY_RATE_MEAS]));
  }

  /** 受信した UBX フレームを 1 件渡す。設定応答でなければ何も起きない */
  handleFrame(frame: Uint8Array): void {
    if (!this.valgetReplyReceived) {
      const values = readValgetValues(frame);
      if (values && (values.has(CFG_KEY_MSGOUT_NAV_PVT_USB) || values.has(CFG_KEY_RATE_MEAS))) {
        this.originalPvtRate = values.get(CFG_KEY_MSGOUT_NAV_PVT_USB) ?? null;
        this.originalPeriodMs = values.get(CFG_KEY_RATE_MEAS) ?? null;
        this.appliedPeriodMs = this.originalPeriodMs;
        this.valgetReplyReceived = true;
        this.applyIfReady();
      }
    }

    const ack = readAckTarget(frame);
    if (!ack || ack.targetClass !== UBX_CLASS.CFG) return;

    if (ack.targetId === UBX_ID.CFG_VALGET) {
      if (ack.accepted) {
        this.valgetAckReceived = true;
        this.applyIfReady();
      } else {
        this.ports.onError('受信機が設定の照会を拒否しました。接続先のUSBポートを確認してください。');
      }
      return;
    }

    if (ack.targetId !== UBX_ID.CFG_VALSET) return;
    // 自分が送っていない書き込みへの応答（切断時の復帰など）は、待ちが空なので素通りする
    const write = this.pendingWrites.shift();
    if (ack.accepted || !write) return;
    if (write.kind === 'enable-pvt') {
      this.temporaryOutputEnabled = false;
      this.ports.onError('受信機が測位データ出力の開始設定を拒否しました。');
    } else {
      // 受信機に残っている値が分からなくなったので、次に選ばれたときは必ず書き直す
      this.appliedPeriodMs = null;
      this.ports.onError('受信機が測位レートの変更を拒否しました。');
    }
  }

  /**
   * 測位間隔（ms）を選び直す。照会が済んでいればすぐに書き、まだなら済んだ時点で書く。
   * 受信機が既にその値なら何も書かない。
   */
  setMeasurementPeriod(periodMs: number): void {
    this.desiredPeriodMs = periodMs;
    this.applyPeriod();
  }

  /** 書き換えた設定をまとめて元へ戻す。何も書き換えていなければ何もしない */
  async restore(): Promise<void> {
    this.closing = true;
    if (!this.ports.canWrite()) return;
    const items: CfgItem[] = [];
    if (this.temporaryOutputEnabled) items.push({ key: CFG_KEY_MSGOUT_NAV_PVT_USB, value: 0 });
    if (this.periodChanged && this.originalPeriodMs !== null) {
      items.push({ key: CFG_KEY_RATE_MEAS, value: this.originalPeriodMs });
    }
    if (items.length === 0) return;
    await this.ports.write(buildValsetRequest(items));
    this.temporaryOutputEnabled = false;
    this.periodChanged = false;
  }

  /** 交渉の途中経過をすべて捨てる。再接続時に呼ぶ。選ばれている測位間隔は持ち越す */
  reset(): void {
    this.originalPvtRate = null;
    this.originalPeriodMs = null;
    this.valgetReplyReceived = false;
    this.valgetAckReceived = false;
    this.negotiated = false;
    this.closing = false;
    this.temporaryOutputEnabled = false;
    this.appliedPeriodMs = null;
    this.periodChanged = false;
    this.pendingWrites = [];
  }

  /** NAV-PVT 出力について、元へ戻すべき設定変更を抱えているか */
  get hasTemporaryOutput(): boolean {
    return this.temporaryOutputEnabled;
  }

  /** 照会応答と ACK が揃ったら、必要な書き込みを一度だけ始める */
  private applyIfReady(): void {
    if (
      this.negotiated
      || this.closing
      || !this.valgetReplyReceived
      || !this.valgetAckReceived
      || !this.ports.canWrite()
    ) return;

    this.negotiated = true;
    if (this.originalPvtRate === 0) {
      this.temporaryOutputEnabled = true;
      this.send({ kind: 'enable-pvt' }, [{ key: CFG_KEY_MSGOUT_NAV_PVT_USB, value: 1 }], () => {
        this.temporaryOutputEnabled = false;
      }, '測位データ出力を開始できませんでした。');
    }
    this.applyPeriod();
  }

  /** 選ばれている測位間隔を受信機へ書く。照会前・後始末中・既に同じ値のときは何もしない */
  private applyPeriod(): void {
    if (!this.negotiated || this.closing || this.originalPeriodMs === null) return;
    if (this.desiredPeriodMs === this.appliedPeriodMs || !this.ports.canWrite()) return;

    this.appliedPeriodMs = this.desiredPeriodMs;
    this.periodChanged = true;
    this.send({ kind: 'set-rate' }, [{ key: CFG_KEY_RATE_MEAS, value: this.desiredPeriodMs }], () => {
      this.appliedPeriodMs = null;
    }, '測位レートを変更できませんでした。');
  }

  /**
   * 書き込みを 1 件送り、応答待ちに積む。
   * 送れなかったものには応答も来ないので、待ちから外して状態を巻き戻す。
   */
  private send(write: PendingWrite, items: CfgItem[], rollback: () => void, fallbackMessage: string): void {
    this.pendingWrites.push(write);
    void this.ports.write(buildValsetRequest(items)).catch((error: unknown) => {
      const index = this.pendingWrites.indexOf(write);
      if (index >= 0) this.pendingWrites.splice(index, 1);
      rollback();
      this.ports.onError(error instanceof Error ? error.message : fallbackMessage);
    });
  }
}
