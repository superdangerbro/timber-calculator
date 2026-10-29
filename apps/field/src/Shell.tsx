import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useApp } from './app';
import { Icon } from './components/Icon';
import { TallyScreen } from './screens/Tally';
import { MeasureScreen } from './screens/Measure';
import { TreesScreen } from './screens/Trees';
import { AuditScreen } from './screens/Audit';
import { MapsScreen } from './screens/Maps';
import { SettingsScreen } from './screens/Settings';

export type Tab = 'tally' | 'trees' | 'audit' | 'maps' | 'settings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'tally', label: 'Tally', icon: 'mic' },
  { id: 'trees', label: 'Trees', icon: 'list' },
  { id: 'audit', label: 'Audit', icon: 'target' },
  { id: 'maps', label: 'Maps', icon: 'map' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
];

/** Keys a Bluetooth clicker / camera remote / keyboard sends. */
export const CLICKER_KEYS = new Set([' ', 'Spacebar', 'Enter', 'ArrowUp', 'ArrowDown', 'MediaPlayPause', 'AudioVolumeUp', 'AudioVolumeDown']);

type PressFn = () => void;
const PressContext = createContext<{ set(fn: PressFn | null): void }>({ set() {} });

/** The current screen's handler for the one physical button. */
export function usePressHandler(fn: PressFn) {
  const ctx = useContext(PressContext);
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = () => ref.current();
    ctx.set(h);
    return () => ctx.set(null);
  }, [ctx]);
}

export function Shell() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).get('tab') as Tab) || 'tally');
  const [measuring, setMeasuring] = useState(false);
  const handlers = useRef<PressFn[]>([]);
  const pressCtx = useRef({
    set(fn: PressFn | null) {
      if (fn) handlers.current.push(fn);
      else handlers.current.pop();
    },
  }).current;

  useEffect(() => {
    app.tally.setOnMeasureHeight(() => setMeasuring(true));
  }, [app]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!CLICKER_KEYS.has(e.key) || e.repeat) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (tag === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) {
        // A focused button would also "click"; blur so the clicker is the only action.
        t?.blur();
      }
      e.preventDefault();
      const h = handlers.current[handlers.current.length - 1];
      h?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <PressContext.Provider value={pressCtx}>
      <div className="shell">
        <main className="screen" data-tab={tab}>
          {tab === 'tally' && <TallyScreen onMeasure={() => setMeasuring(true)} />}
          {tab === 'trees' && <TreesScreen />}
          {tab === 'audit' && <AuditScreen />}
          {tab === 'maps' && <MapsScreen />}
          {tab === 'settings' && <SettingsScreen />}
        </main>
        <nav className="tabbar" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'tab active' : 'tab'}
              data-testid={`tab-${t.id}`}
              onClick={() => setTab(t.id)}
            >
              <Icon name={t.icon} size={26} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        {measuring && <MeasureScreen onClose={() => setMeasuring(false)} />}
      </div>
    </PressContext.Provider>
  );
}
