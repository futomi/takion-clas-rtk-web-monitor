import type { ConnectionState } from '../lib/types';

/**
 * 接続状態チップの表示文字列。
 *
 * 確立済みと確立途中は取り違えると意味が逆になるため、
 * 三点リーダの有無ではなく語そのものを変えて区別する。
 */
const CONNECTION_TEXT: Record<ConnectionState, string> = {
  connected: '受信機 接続済み',
  connecting: '受信機 接続中…',
  disconnecting: '受信機 切断中…',
  idle: '受信機 未接続',
};

/** アプリ名と受信機の接続状態を示すヘッダー */
export default function AppHeader({ connection }: { connection: ConnectionState }) {
  return (
    <header className="topbar">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true"><span /></div>
        <div>
          <p className="eyebrow">GNSS / CLAS &amp; NETWORK RTK</p>
          <h1>Takion CLAS / RTK Monitor</h1>
        </div>
      </div>
      <div className="header-status">
        <div className={`connection-chip ${connection}`}>
          <span className="status-dot" />
          {CONNECTION_TEXT[connection]}
        </div>
      </div>
    </header>
  );
}
