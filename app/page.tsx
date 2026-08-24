import MonitorClient from './MonitorClient';

export const runtime = 'edge';

export default function Home() {
  const configuredToken = process.env.MAPBOX_ACCESS_TOKEN?.trim() ?? '';
  const isPublicToken = configuredToken.startsWith('pk.');

  return (
    <MonitorClient
      mapboxAccessToken={isPublicToken ? configuredToken : ''}
      mapboxTokenError={configuredToken && !isPublicToken
        ? 'Mapboxには pk. で始まる公開トークンを設定してください。'
        : undefined}
    />
  );
}
