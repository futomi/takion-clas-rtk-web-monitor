import { BAUD_RATE_OPTIONS, UBLOX_VENDOR_ID } from '../lib/constants';
import { formatHex } from '../lib/format';
import type { ConnectionState } from '../lib/types';
import type { SerialPortInfo } from '../lib/webSerial';

type DeviceToolbarProps = {
  connection: ConnectionState;
  isSupported: boolean;
  portInfo: SerialPortInfo;
  baudRate: number;
  onBaudRateChange: (baudRate: number) => void;
  onConnect: () => void;
  onDisconnect: () => void;
};

/** 受信機への接続操作パネル */
export default function DeviceToolbar({
  connection,
  isSupported,
  portInfo,
  baudRate,
  onBaudRateChange,
  onConnect,
  onDisconnect,
}: DeviceToolbarProps) {
  return (
    <section className="device-toolbar panel" aria-label="受信機への接続">
      <div className="device-heading">
        <p className="card-label">USB SERIAL RECEIVER</p>
        <div className="device-name">
          <h2>TakionCM001</h2>
          <span className={`api-badge ${isSupported ? 'supported' : 'unsupported'}`}>
            {isSupported ? 'Web Serial' : '非対応'}
          </span>
        </div>
      </div>

      <div className="device-id">
        <span>VID / PID</span>
        <code>{formatHex(portInfo.usbVendorId || UBLOX_VENDOR_ID)} / {formatHex(portInfo.usbProductId)}</code>
      </div>

      <label className="baud-control">
        <span>Baud</span>
        <select
          value={baudRate}
          disabled={connection !== 'idle'}
          onChange={(event) => onBaudRateChange(Number(event.target.value))}
        >
          {BAUD_RATE_OPTIONS.map((rate) => (
            <option value={rate} key={rate}>{rate.toLocaleString()} bps</option>
          ))}
        </select>
      </label>

      {connection === 'connected' ? (
        <button type="button" className="connect-button disconnect-button" onClick={onDisconnect}>
          切断
        </button>
      ) : (
        <button
          type="button"
          className="connect-button"
          onClick={onConnect}
          disabled={!isSupported || connection !== 'idle'}
        >
          {connection === 'connecting' ? '接続中…' : '接続'}
        </button>
      )}
    </section>
  );
}
