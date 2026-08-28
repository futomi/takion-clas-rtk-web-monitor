import { memo } from 'react';

/** リポジトリの場所。ローカルで動かしたい人の導線 */
const REPOSITORY_URL = 'https://github.com/futomi/takion-clas-rtk-web-monitor';

/**
 * 公開環境でネットワーク RTK を選んだときに、接続設定フォームの代わりに出す案内。
 *
 * 選択肢ごと黙って消さないのは、README にもリポジトリにも NTRIP の説明があるため。
 * 見当たらないと「壊れている」と受け取られる。理由まで書いておくと、
 * このアプリが認証情報をどう扱う方針なのかの説明も兼ねられる。
 */
function NtripUnavailableNotice() {
  return (
    <section className="ntrip-unavailable panel" aria-label="ネットワークRTKの利用について">
      <div className="ntrip-panel-header">
        <h3>ネットワークRTK は公開版では使えません</h3>
      </div>

      <p className="ntrip-unavailable-lead">
        NTRIP はブラウザから配信局へ直接つなげないため、サーバーが中継する必要があります。
        その経路には配信局（Caster）の認証情報が乗るため、他人のサーバーへ預けずに済むよう、
        この機能はローカル実行時のみ提供しています。
      </p>

      <p>
        お使いになる場合は、下記のリポジトリをご自身のマシンで起動してください。
        導入手順は README に書いてあります。追加の設定は要りません。
        <code>localhost</code> で開いた時点で有効になります。
      </p>

      <p className="ntrip-unavailable-repository">
        <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">{REPOSITORY_URL}</a>
      </p>

      <p className="field-note">
        CLAS（みちびき L6）による補正は、公開版でもそのまま使えます。
        受信機が衛星から直接受け取るため、インターネット接続も中継サーバーも要りません。
      </p>
    </section>
  );
}

/* 親の再描画に巻き込まれる理由が無いので memo で包む（他のパネルと同じ扱い） */
export default memo(NtripUnavailableNotice);
