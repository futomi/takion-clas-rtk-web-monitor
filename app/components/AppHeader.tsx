import type { ConnectionState } from '../lib/types';

/** 接続状態チップの表示文字列 */
function connectionText(connection: ConnectionState): string {
  if (connection === 'connected') return '受信機 接続中';
  if (connection === 'connecting') return '受信機 接続中…';
  return '受信機 未接続';
}

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
          {connectionText(connection)}
        </div>
      </div>
    </header>
  );
}
