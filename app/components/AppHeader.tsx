import { memo } from 'react';
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
function AppHeader({ connection }: { connection: ConnectionState }) {
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

/*
 * 親は経過時間の表示のため毎秒、測位状態の更新のためさらに細かく再描画される。
 * このパネルは自分が受け取る値にしか依存しないので memo で包み、
 * 関係のない再描画に巻き込まれないようにする。
 */
export default memo(AppHeader);
