import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { AppContext, createApp, type App as AppT } from './app';
import { createPlatform } from './platform';
import { Shell } from './Shell';

// ?notch=1 draws iPhone 17 Pro Max safe areas in a desktop browser so layout can be checked.
if (new URLSearchParams(location.search).get('notch') === '1') document.documentElement.classList.add('fake-notch');

let appPromise: Promise<AppT> | null = null;

function Root() {
  const [app, setApp] = useState<AppT | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    appPromise ??= createApp(createPlatform());
    appPromise.then(setApp, (e) => setError(String(e?.message ?? e)));
  }, []);
  if (error)
    return (
      <div className="boot">
        <div className="boot-title">Could not start</div>
        <div className="boot-msg">{error}</div>
      </div>
    );
  if (!app)
    return (
      <div className="boot">
        <div className="boot-title">Timber Tally</div>
      </div>
    );
  return (
    <AppContext.Provider value={app}>
      <Shell />
    </AppContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
