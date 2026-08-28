import { isLoopbackHost } from '../localHost';

/**
 * NTRIP 中継を受け付けてよい状況かを判定する。
 *
 * `/api/ntrip/*` は、このアプリが第三者のサーバーへ TCP を張る唯一の経路であり、
 * 公開すると (1) 利用者の Caster 認証情報が中継サーバーを通り、
 * (2) Caster から見れば全アクセスが 1 つの IP に集まる。しかもストリームの実行時間上限は
 * PaaS ごとに違い、公開しても中途半端にしか動かない（数分で切れて黙って止まる）。
 * そこで「本人のマシンで動かしているとき」だけ受け付ける。
 *
 * 判定は 2 段で、どちらも満たす必要がある。
 *
 * 1. 既知のマネージド環境の目印が見えたら、何があっても拒む。
 *    これらはプラットフォームが入れる環境変数で、リクエスト側からは消せない。
 * 2. そのうえで `Host` がループバックを指すことを求める。
 *
 * `Host` だけだと、ブラウザ以外のクライアントに詐称され得る（{@link ../localHost} の注記）。
 * 逆に 1 だけだと一覧に無いプラットフォームを取りこぼす。互いの穴を塞ぐために両方を通す。
 *
 * 開ける手段は用意しない。中継を公開状態で動かすと、利用者の配信局アカウントの認証情報を
 * 預かることになり、配信局から見ればすべてのアクセスが 1 つの IP に集まる。
 * このアプリはローカルで使うものとして配っている。
 */

/**
 * 「マネージドな実行環境の上に居る」ことを示す環境変数。
 *
 * 網羅を狙ったものではなく、`Host` 判定を補強する 2 枚目として置いている。
 * ここに載っていないプラットフォームは 1 枚目だけで守られる。
 *
 * テストが一覧と食い違わないよう公開している。
 */
export const PLATFORM_MARKERS = [
  'VERCEL', // Vercel
  'RENDER', // Render
  'NETLIFY', // Netlify
  'CF_PAGES', // Cloudflare Pages
  'FLY_APP_NAME', // Fly.io
  'RAILWAY_ENVIRONMENT', // Railway
  'DYNO', // Heroku
  'K_SERVICE', // Google Cloud Run
  'WEBSITE_INSTANCE_ID', // Azure App Service
  'AWS_LAMBDA_FUNCTION_NAME', // AWS Lambda（Netlify や Vercel の実体でもある）
];

/** 既知のマネージド環境の上で動いているか */
export function isManagedPlatform(): boolean {
  return PLATFORM_MARKERS.some((name) => (process.env[name] ?? '') !== '');
}

/**
 * NTRIP 中継を受け付けてよいか。
 *
 * 判定のたびに環境変数を読み直すのは、{@link ./streamLimit} の上限値と同じ理由による
 * （テストから差し替えられるようにするため。呼ばれるのは接続開始時だけ）。
 */
export function isNtripAvailable(headers: Headers): boolean {
  if (isManagedPlatform()) return false;

  const host = headers.get('host');
  return host !== null && isLoopbackHost(host);
}
