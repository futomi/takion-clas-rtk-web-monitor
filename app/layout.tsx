import type { Metadata } from 'next';
import 'mapbox-gl/dist/mapbox-gl.css';
import './globals.css';
import './map.css';

const siteOrigin = process.env.SITE_ORIGIN ?? 'http://localhost:3000';
const socialImage = new URL('/og.png', siteOrigin).toString();

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: 'CLAS Monitor — みちびき測位モニター',
  description: 'TakionCM001のUSBシリアル出力をChromeで読み取り、CLAS測位情報とUBX・NMEA・RTCMログを表示するウェブアプリです。',
  openGraph: {
    title: 'CLAS Monitor — みちびき測位モニター',
    description: 'TakionCM001のUSBシリアル出力をChromeで読み取る、コンパクトなCLAS測位モニターです。',
    type: 'website',
    locale: 'ja_JP',
    images: [{ url: socialImage, width: 1728, height: 912, alt: 'CLAS Monitor — みちびき測位モニター' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CLAS Monitor — みちびき測位モニター',
    description: 'TakionCM001の測位情報と受信ログをChromeでリアルタイム表示します。',
    images: [socialImage],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}
