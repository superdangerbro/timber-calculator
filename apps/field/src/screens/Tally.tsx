import { useEffect, useMemo, useRef, useState } from 'react';
import { SPECIES, type Scale, type SpeciesCode, type TreeFields, type UnitSystem } from '@timber/core';
import { useApp } from '../app';
import { useEmitter } from '../lib/emitter';
import { Icon } from '../components/Icon';
import { GpsChip, SyncChip } from '../components/chips';
import { ClashBanner } from '../components/ClashBanner';
import { FIELD_META, Modal, SCALE_HINT, SpeciesDot } from '../components/fields';
import { PhotoButtons } from '../components/Photos';
import { TreeCard } from '../components/TreeCard';
import { TreeMap } from '../map/TreeMap';
import { isToday } from '../state/repo';
import { pinOffsetText } from '../lib/geo';
import { capturePhoto, compressImage } from '../lib/photo';
import { dbhFromCirc, girthToCm, girthUnit, heightToM, heightUnit, showGirth, showHeight } from '../lib/units';
import { money, safeSummary, safeValue, sawlogM3, scenarioPriced } from '../lib/valuation';
import { usePressHandler } from '../Shell';
import { missingLabel, type PendingPhoto, type TallyState, type TallyStep } from '../state/tally';

const DEFECT_CHIPS = ['rot', 'sweep', 'fork', 'crook', 'scar', 'conk', 'dead top', 'broken top', 'frost crack', 'catface'];

const STEPS: { n: number; label: string }[] = [
  { n: 1, label: 'Pin' },
  { n: 2, label: 'Measure' },
  { n: 3, label: 'Photo' },
  { n: 4, label: 'Tag' },
];

function stepIndex(step: TallyStep, pinned: boolean): number {
  if (step === 'measure') return pinned ? 2 : 1;
  if (step === 'photo') return 3;
  if (step === 'saved') return 4;
  return 0;
}

function StepBar({ step, pinned }: { step: TallyStep; pinned: boolean }) {
  const cur = stepIndex(step, pinned);
  return (
    <ol className="stepbar" data-testid="stepbar">
      {STEPS.map((s) => (
        <li key={s.n} className={s.n < cur ? 'done' : s.n === cur ? 'on' : ''}>
          <span className="stepbar-n">{s.n < cur ? <Icon name="check" size={14} stroke={3} /> : s.n}</span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

function TagHero({ tag, fresh }: { tag: string | null; fresh: boolean }) {
  if (!tag)
    return (
      <div className="tag-hero empty" data-testid="last-tag">
        <div className="tag-caption">Press New tree to start</div>
      </div>
    );
  const parts = tag.split('-');
  const block = parts.length >= 3 ? parts[0] : null;
  const main = block ? parts.slice(1).join('-') : tag;
  return (
    <div className={fresh ? 'tag-hero fresh' : 'tag-hero'} data-testid="last-tag">
      <div className="tag-caption">
        {fresh ? 'Write this on the tape' : 'Last tag'}
        {block && <span className="tag-block">{block}</span>}
      </div>
      <div className="tag-big" data-testid="tag-big" style={{ fontSize: Math.min(116, Math.floor(404 / (main.length * 0.6))) }}>
        {main}
      </div>
    </div>
  );
}

function PinBar({
  t,
  onRePin,
  onPinNow,
  onAdjust,
  units,
}: {
  t: TallyState;
  onRePin: () => void;
  onPinNow: () => void;
  onAdjust: () => void;
  units: UnitSystem;
}) {
  const { gps } = useApp();
  const g = useEmitter(gps);
  const ft = (m: number) => (units === 'imperial' ? `±${Math.round(m / 0.3048)} ft` : `±${m.toFixed(1)} m`);
  if (t.pin.status === 'pinning') {
    const a = g.averaged;
    return (
      <div className="pinbar pinning" data-testid="pinbar">
        <Icon name="gps" size={22} />
        <div className="pinbar-text">
          <b>Pinning location…</b>
          <span>{a ? `${ft(a.accuracyM)} · ${a.fixCount} fix${a.fixCount === 1 ? '' : 'es'}` : 'waiting for GPS'}</span>
        </div>
        <button className="btn ghost small" onClick={onPinNow} disabled={!a} data-testid="pin-now">
          Pin now
        </button>
        <button className="btn ghost small" onClick={onAdjust} data-testid="adjust-pin">
          Adjust
        </button>
      </div>
    );
  }
  const p = t.pin.position;
  const moved = pinOffsetText(p, units);
  return (
    <div className={`pinbar ${p ? (moved ? 'pinned moved' : 'pinned') : 'nofix'}`} data-testid="pinbar">
      <Icon name={p ? 'check' : 'alert'} size={22} stroke={2.6} />
      <div className="pinbar-text">
        <b>{p ? (moved ? 'Pin placed by hand' : 'Location pinned') : 'No GPS fix'}</b>
        <span data-testid="pin-accuracy">
          {p ? moved ?? `${ft(p.accuracyM)} · ${p.fixCount} fix${p.fixCount === 1 ? '' : 'es'}` : 'Re-pin, or place it on the map'}
        </span>
      </div>
      <button className="btn ghost small" onClick={onAdjust} data-testid="adjust-pin">
        Adjust
      </button>
      <button className="btn ghost small" onClick={onRePin} data-testid="re-pin">
        Re-pin
      </button>
    </div>
  );
}

/** Full-map "Adjust pin" mode: pan the map under the crosshair, or drag the pin. */
function AdjustPanel({ t, units }: { t: TallyState; units: UnitSystem }) {
  const { tally } = useApp();
  const p = t.pin.position;
  const moved = pinOffsetText(p, units);
  const canReset = !!moved;
  return (
    <div className="adjust-panel" data-testid="adjust-panel">
      <div className="adjust-title">
        <Icon name="gps" size={22} />
        <div>
          <b>Put the crosshair on the tree</b>
          <span data-testid="adjust-offset">{moved ?? 'On the GPS fix. Drag the map to move it.'}</span>
        </div>
      </div>
      <div className="adjust-actions">
        <button className="btn ghost" onClick={() => tally.cancelAdjustPin()} data-testid="adjust-cancel">
          Cancel
        </button>
        <button className="btn ghost" onClick={() => tally.resetPinToGps()} disabled={!canReset} data-testid="adjust-reset">
          Back to GPS
        </button>
        <button className="btn primary" onClick={() => tally.finishAdjustPin()} data-testid="adjust-use">
          Use this spot
        </button>
      </div>
    </div>
  );
}

/** Numeric input that keeps what you type while focused and follows voice/other changes otherwise. */
function NumberField({
  label,
  unit,
  value,
  onCommit,
  testId,
  missing,
  right,
}: {
  label: string;
  unit: string;
  value: number | undefined;
  onCommit: (n: number | undefined) => void;
  testId: string;
  missing?: boolean;
  right?: React.ReactNode;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value === undefined ? '' : String(value));
  }, [value]);
  const commit = () => {
    const n = parseFloat(text.replace(',', '.'));
    onCommit(Number.isFinite(n) && n > 0 ? n : undefined);
  };
  return (
    <label className={`num-field${missing ? ' missing' : ''}`}>
      <span className="num-label">{label}</span>
      <span className="num-row">
        <input
          inputMode="decimal"
          enterKeyHint="done"
          value={text}
          placeholder="—"
          onFocus={() => (focused.current = true)}
          onBlur={() => {
            focused.current = false;
            commit();
          }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          data-testid={testId}
        />
        <span className="num-unit">{unit}</span>
        {right}
      </span>
    </label>
  );
}

function SegRow({ field, value, missing, onPick }: { field: 'straightness' | 'twist' | 'branchiness'; value?: Scale; missing: boolean; onPick: (n: Scale) => void }) {
  return (
    <div className={`seg-block${missing ? ' missing' : ''}`}>
      <div className="seg-head">
        <span>{FIELD_META[field].label}</span>
        <span className="seg-hint">{value ? SCALE_HINT[field][value] : missing ? 'missing' : ''}</span>
      </div>
      <div className="seg-row" role="radiogroup" aria-label={FIELD_META[field].label}>
        {([1, 2, 3, 4, 5] as Scale[]).map((n) => (
          <button key={n} role="radio" aria-checked={value === n} className={value === n ? 'seg-btn on' : 'seg-btn'} onClick={() => onPick(n)} data-testid={`seg-${field}-${n}`}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function splitDefects(d?: string) {
  return (d ?? '').split(/;\s*/).map((s) => s.trim()).filter(Boolean);
}

function DefectsField({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const parts = splitDefects(value);
  const isChip = (p: string) => DEFECT_CHIPS.some((c) => p.toLowerCase().includes(c));
  const other = parts.filter((p) => !isChip(p)).join('; ');
  const [text, setText] = useState(other);
  useEffect(() => setText(other), [other]);
  const rebuild = (chipParts: string[], otherText: string) => {
    const all = [...chipParts, ...splitDefects(otherText)];
    onChange(all.length ? all.join('; ') : undefined);
  };
  const chipParts = parts.filter(isChip);
  return (
    <div className="defects-block">
      <div className="seg-head">
        <span>Defects</span>
        <span className="seg-hint">optional</span>
      </div>
      <div className="defect-chips">
        {DEFECT_CHIPS.map((c) => {
          const on = chipParts.some((p) => p.toLowerCase().includes(c));
          return (
            <button
              key={c}
              className={on ? 'dchip on' : 'dchip'}
              onClick={() => rebuild(on ? chipParts.filter((p) => !p.toLowerCase().includes(c)) : [...chipParts, c], other)}
              data-testid={`defect-${c.replace(' ', '-')}`}
            >
              {c}
            </button>
          );
        })}
      </div>
      <input
        className="defect-other"
        value={text}
        placeholder="Other (e.g. rot at the butt)"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => rebuild(chipParts, text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        data-testid="defect-other"
      />
    </div>
  );
}

function TreeForm({ t, units, measure, onMeasure }: { t: TallyState; units: UnitSystem; measure: 'circumference' | 'dbh'; onMeasure: () => void }) {
  const { tally } = useApp();
  const d = t.draft;
  const [mode, setMode] = useState<'circumference' | 'dbh'>(measure);
  useEffect(() => {
    // Voice may give a DBH directly; show what was entered.
    if (d.dbhCm !== undefined && (d.circumferenceCm === undefined || d.circumferenceCm === null) && mode === 'circumference' && measure === 'circumference' && d.dbhCm !== null) setMode('dbh');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.dbhCm, d.circumferenceCm]);
  const miss = (k: keyof TreeFields) => t.showMissing && t.missing.includes(k);
  const gu = girthUnit(units);
  return (
    <div className="tree-form" data-testid="tree-form">
      <div className="form-block">
        <div className="seg-head">
          <span>Species</span>
          <span className="seg-hint">{miss('species') ? 'missing' : ''}</span>
        </div>
        <div className={`species-chips${miss('species') ? ' missing' : ''}`}>
          {(SPECIES ?? []).map((s) => (
            <button
              key={s.code}
              className={d.species === s.code ? 'sp-chip on' : 'sp-chip'}
              onClick={() => tally.setField({ species: s.code as SpeciesCode })}
              title={s.name}
              data-testid={`sp-chip-${s.code}`}
            >
              <SpeciesDot code={s.code} size={14} />
              {s.code}
            </button>
          ))}
        </div>
        {d.species && <div className="species-full">{SPECIES.find((s) => s.code === d.species)?.name}</div>}
      </div>

      <div className="form-two">
        {mode === 'circumference' ? (
          <NumberField
            label="Circumference"
            unit={gu}
            value={d.circumferenceCm ? showGirth(d.circumferenceCm, units) : undefined}
            missing={miss('dbhCm')}
            onCommit={(n) => {
              const c = n ? girthToCm(n, units) : null;
              tally.setField(c ? { circumferenceCm: c, dbhCm: dbhFromCirc(c) } : { circumferenceCm: undefined, dbhCm: undefined });
            }}
            testId="input-circ"
          />
        ) : (
          <NumberField
            label="DBH"
            unit={gu}
            value={d.dbhCm ? showGirth(d.dbhCm, units) : undefined}
            missing={miss('dbhCm')}
            onCommit={(n) => tally.setField({ dbhCm: n ? girthToCm(n, units) : undefined, circumferenceCm: undefined })}
            testId="input-dbh"
          />
        )}
        <NumberField
          label="Height"
          unit={heightUnit(units)}
          value={d.heightM ? showHeight(d.heightM, units) : undefined}
          missing={miss('heightM')}
          onCommit={(n) => tally.setField(n ? { heightM: heightToM(n, units), heightSource: 'estimated' } : { heightM: undefined, heightSource: undefined })}
          testId="input-height"
          right={
            <button className="icon-btn measure-btn" aria-label="Measure height with the phone" onClick={onMeasure} data-testid="open-measure">
              <Icon name="ruler" size={22} />
            </button>
          }
        />
      </div>
      <div className="girth-note" data-testid="derived-dbh">
        {mode === 'circumference'
          ? d.dbhCm
            ? `DBH ${showGirth(d.dbhCm, units)} ${gu} (circumference ÷ π)`
            : 'DBH is worked out from the circumference.'
          : 'Diameter at breast height.'}
        <button className="linkish" onClick={() => setMode(mode === 'circumference' ? 'dbh' : 'circumference')} data-testid="girth-mode">
          {mode === 'circumference' ? 'Enter DBH instead' : 'Enter circumference instead'}
        </button>
        {d.heightSource === 'clinometer' && <span className="src-tag">height measured</span>}
      </div>

      <SegRow field="straightness" value={d.straightness} missing={miss('straightness')} onPick={(n) => tally.setField({ straightness: n })} />
      <SegRow field="twist" value={d.twist} missing={miss('twist')} onPick={(n) => tally.setField({ twist: n })} />
      <SegRow field="branchiness" value={d.branchiness} missing={miss('branchiness')} onPick={(n) => tally.setField({ branchiness: n })} />

      <DefectsField value={d.defects} onChange={(v) => tally.setField({ defects: v })} />

      <button className={d.leaveTree ? 'leave-toggle on' : 'leave-toggle'} onClick={() => tally.setField({ leaveTree: d.leaveTree ? undefined : true })} data-testid="leave-toggle">
        <span className="leave-box">{d.leaveTree && <Icon name="check" size={18} stroke={3} />}</span>
        <span>
          <b>Leave tree</b>
          <small>keep standing · gets an L tag</small>
        </span>
      </button>
    </div>
  );
}

function PendingThumb({ p, onRemove }: { p: PendingPhoto; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(p.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [p.blob]);
  return (
    <div className="pending-thumb" data-testid="pending-photo">
      {url && <img src={url} alt="Tree photo" />}
      <button className="icon-btn glass" aria-label="Remove photo" onClick={onRemove}>
        <Icon name="x" size={18} />
      </button>
    </div>
  );
}

function PhotoStep({ t }: { t: TallyState }) {
  const { tally, gps, platform } = useApp();
  const [busy, setBusy] = useState(false);
  const take = async (source: 'camera' | 'library') => {
    setBusy(true);
    try {
      const raw = await capturePhoto(source);
      if (!raw) return;
      const small = await compressImage(raw);
      const pos = gps.getState().last;
      tally.addPendingPhoto({ ...small, lat: pos?.lat ?? null, lon: pos?.lon ?? null });
    } catch (e) {
      tally.setNotice(`Photo: ${(e as Error).message || 'could not take photo'}`);
    } finally {
      setBusy(false);
    }
  };
  const asked = useRef(t.cameraAsk);
  useEffect(() => {
    // "photo" voice command: open the camera straight away on the phone.
    if (t.cameraAsk !== asked.current) {
      asked.current = t.cameraAsk;
      if (platform.native) void take('camera');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.cameraAsk]);
  return (
    <div className="photo-step" data-testid="photo-step">
      <p className="hint">Get the tree and its flagging spot in the shot. Optional.</p>
      {t.pendingPhotos.length > 0 && (
        <div className="pending-row">
          {t.pendingPhotos.map((p, i) => (
            <PendingThumb key={i} p={p} onRemove={() => tally.removePendingPhoto(i)} />
          ))}
        </div>
      )}
      <div className="photo-buttons">
        <button className="btn primary big" disabled={busy} onClick={() => void take('camera')} data-testid="photo-camera">
          <Icon name="camera" size={26} /> {busy ? 'Saving…' : t.pendingPhotos.length ? 'Another photo' : 'Take photo'}
        </button>
        <button className="btn ghost big" disabled={busy} onClick={() => void take('library')} data-testid="photo-library">
          <Icon name="image" size={24} /> Choose photo
        </button>
      </div>
    </div>
  );
}

function VoicePanel({ t, measure, units }: { t: TallyState; measure: 'circumference' | 'dbh'; units: UnitSystem }) {
  const { tally, platform } = useApp();
  const [typed, setTyped] = useState('');
  const typeBox = platform.speech.kind === 'text';
  const example =
    measure === 'circumference'
      ? units === 'imperial'
        ? '“fir, circ seventy five, ninety eight feet, straight four…”'
        : '“fir, circ one ninety, thirty metres, straight four…”'
      : units === 'imperial'
        ? '“fir, twenty four inches, ninety eight feet…”'
        : '“fir forty two, thirty metres, straight four…”';
  return (
    <div className={`convo voice-${t.mic}`} data-testid="convo">
      {t.mic !== 'off' && (
        <div className="listen-bar" data-testid="listening">
          <span className="pulse" />
          <div className="listen-text">
            <b>{t.mic === 'thinking' ? 'Working it out…' : t.speaking ? 'Reading back…' : 'Listening — talk now'}</b>
            <span className="listen-live" data-testid="partial">
              {t.partial || (t.mic === 'listening' && !t.speaking ? '(nothing heard yet)' : '')}
            </span>
          </div>
          <button className="btn stop-btn" onClick={() => void tally.voiceOff()} data-testid="voice-stop">
            <Icon name="x" size={22} stroke={3} /> Stop
          </button>
        </div>
      )}
      <div className="convo-line heard">
        <Icon name="ear" size={18} />
        <span data-testid="heard">{t.heard || <i>Say {example}, then “photo” or “save”</i>}</span>
      </div>
      {t.spoken && (
        <div className={`convo-line spoken${t.speaking ? ' live' : ''}`}>
          <Icon name="speaker" size={18} />
          <span data-testid="spoken">{t.spoken}</span>
        </div>
      )}
      {typeBox && (
        <form
          className="type-row small"
          onSubmit={(e) => {
            e.preventDefault();
            const text = typed.trim();
            if (!text) return;
            setTyped('');
            tally.submitText(text);
          }}
        >
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type what you'd say" enterKeyHint="send" autoCapitalize="off" autoCorrect="off" data-testid="type-input" />
          <button type="submit" className="type-send" aria-label="Send" data-testid="type-send">
            <Icon name="send" size={22} />
          </button>
        </form>
      )}
    </div>
  );
}

function MicButton({ t }: { t: TallyState }) {
  const { tally } = useApp();
  return (
    <button
      className={`mic-btn ${t.voice ? t.mic : 'off'}`}
      aria-label={t.voice ? 'Stop voice entry' : 'Use voice'}
      aria-pressed={t.voice}
      onClick={() => void tally.toggleVoice()}
      data-testid="mic"
    >
      <Icon name="mic" size={26} stroke={2.4} />
      <span>{t.voice ? (t.mic === 'thinking' ? 'Thinking' : 'Stop') : 'Voice'}</span>
    </button>
  );
}

const MISSING_LABEL = (k: keyof TreeFields, measure: 'circumference' | 'dbh') =>
  k === 'dbhCm' || k === 'heightM' ? missingLabel(k, measure) : (FIELD_META[k as keyof typeof FIELD_META]?.label ?? k).toLowerCase();

export function TallyScreen({ onMeasure }: { onMeasure: () => void }) {
  const app = useApp();
  const { tally, repo, gps } = app;
  const t = useEmitter(tally);
  const r = useEmitter(repo);
  const g = useEmitter(gps);
  const [cardId, setCardId] = useState<string | null>(null);
  const units = r.settings.units;
  const measure = r.settings.measure;
  const priced = scenarioPriced(repo.scenario);
  const bodyRef = useRef<HTMLDivElement>(null);

  usePressHandler(() => void tally.press());
  useEffect(() => tally.resume(), [tally]);
  useEffect(() => {
    bodyRef.current?.scrollTo?.({ top: 0 });
  }, [t.step]);
  useEffect(() => {
    if (!t.notice) return;
    const id = setTimeout(() => tally.setNotice(null), 4000);
    return () => clearTimeout(id);
  }, [t.notice, tally]);

  const today = useMemo(() => r.trees.filter((x) => isToday(x.createdAt)), [r.trees]);
  const scenario = repo.scenario;
  const summary = useMemo(() => safeSummary(today.filter((x) => !x.voided), scenario), [today, scenario]);
  const rings = useMemo(() => {
    const out: Record<string, string> = {};
    for (const x of today) if (!x.voided && safeValue(x, scenario).product === 'pole') out[x.id] = '#ff6b1a';
    return out;
  }, [today, scenario]);

  const inTree = t.step === 'measure' || t.step === 'photo';
  const adjusting = inTree && !!t.pin.adjusting;
  const pinned = t.pin.status === 'pinned';
  // Once pinned, the blue dot is the averaged GPS fix (not a hand-moved pin), so the offset shows.
  const pp = t.pin.position;
  const position = pp
    ? { lat: pp.gpsLat ?? pp.lat, lon: pp.gpsLon ?? pp.lon, accuracyM: pp.gpsAccuracyM ?? pp.accuracyM }
    : g.averaging && g.averaged ? g.averaged : g.last;
  const fresh = t.step === 'saved' && !r.clashes.some((c) => c.tree.id === t.lastTreeId);
  const lastTree = t.lastTreeId ? repo.tree(t.lastTreeId) : undefined;

  return (
    <div className={`tally step-${t.step}${inTree ? ' in-tree' : ''}${adjusting ? ' adjusting' : ''}`} data-phase={t.step} data-step={t.step}>
      <div className="tally-map">
        <TreeMap
          trees={today}
          blocks={r.blocks}
          position={position ? { lat: position.lat, lon: position.lon, accuracyM: position.accuracyM } : null}
          labelIds={t.lastTreeId ? [t.lastTreeId] : []}
          rings={rings}
          padTop={0}
          onSelect={adjusting ? undefined : setCardId}
          testId="tally-map"
          pin={inTree && t.pin.position ? { lat: t.pin.position.lat, lon: t.pin.position.lon } : null}
          adjusting={adjusting}
          onPinMove={(lat, lon) => tally.movePin(lat, lon)}
        />
        <div className="map-chips">
          <GpsChip />
          <SyncChip />
        </div>
        {!inTree && (
          <div className="totals-overlay" data-testid="totals">
            <div>
              <b>{summary.treeCount}</b>
              <span>trees</span>
            </div>
            <div>
              <b>{summary.poleCount}</b>
              <span>poles</span>
            </div>
            <div>
              <b>{sawlogM3(summary).toFixed(1)}</b>
              <span>saw m³</span>
            </div>
            {priced ? (
              <div>
                <b>{money(summary.totalValue)}</b>
                <span>value</span>
              </div>
            ) : (
              <div data-testid="totals-volume">
                <b>{summary.totalVolumeM3.toFixed(1)}</b>
                <span>total m³</span>
              </div>
            )}
          </div>
        )}
      </div>

      <section className="sheet" data-testid="sheet">
        <div className="sheet-grip">
          <span />
        </div>
        {adjusting ? (
          <AdjustPanel t={t} units={units} />
        ) : (
          <>
            <ClashBanner />
            {t.step !== 'idle' && <StepBar step={t.step} pinned={pinned} />}

            <div className="sheet-body" ref={bodyRef}>
              {t.step === 'measure' && (
                <>
                  <PinBar t={t} units={units} onRePin={() => tally.rePin()} onPinNow={() => tally.pinNow()} onAdjust={() => tally.startAdjustPin()} />
                  <TreeForm t={t} units={units} measure={measure} onMeasure={onMeasure} />
                </>
              )}
              {t.step === 'photo' && (
                <>
                  <PinBar t={t} units={units} onRePin={() => tally.rePin()} onPinNow={() => tally.pinNow()} onAdjust={() => tally.startAdjustPin()} />
                  <PhotoStep t={t} />
                </>
              )}
              {(t.step === 'idle' || t.step === 'saved') && (
                <>
                  <TagHero tag={t.lastTag} fresh={fresh} />
                  {t.lastTag && lastTree && (
                    <div className="saved-actions">
                      <button className="btn ghost" onClick={() => tally.requestPhoto()} data-testid="saved-photo">
                        <Icon name="camera" size={22} />
                        Photo{(lastTree.photos?.length ?? 0) > 0 ? ` (${lastTree.photos?.length})` : ''}
                      </button>
                      <button className="btn ghost" onClick={() => void tally.repeat()} data-testid="repeat">
                        <Icon name="speaker" size={22} /> Say it
                      </button>
                      <button className="btn ghost" onClick={() => void tally.undo()} data-testid="undo">
                        <Icon name="undo" size={22} /> Undo
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {t.voice && <VoicePanel t={t} measure={measure} units={units} />}

            {t.notice && (
              <div className="tally-toast" data-testid="notice" role="status">
                {t.notice}
              </div>
            )}

            <div className="step-actions">
              <MicButton t={t} />
              {t.step === 'measure' && (
                <>
                  <button className="btn ghost act-side" onClick={() => tally.cancelTree()} data-testid="cancel-tree">
                    Cancel
                  </button>
                  <button className="act-main" onClick={() => tally.goPhoto()} data-testid="next-photo">
                    <span>Next: photo</span>
                    <span className="arrow-right">
                      <Icon name="arrow" size={26} stroke={2.6} />
                    </span>
                  </button>
                </>
              )}
              {t.step === 'photo' && (
                <>
                  <button className="btn ghost act-side" onClick={() => tally.backToMeasure()} data-testid="back-measure">
                    Back
                  </button>
                  <button className="act-main tag" onClick={() => void tally.getTag()} data-testid="get-tag">
                    <span>{t.pendingPhotos.length ? 'Get tag number' : 'Skip photo · get tag'}</span>
                  </button>
                </>
              )}
              {(t.step === 'idle' || t.step === 'saved') && (
                <button className="act-main new" onClick={() => tally.newTree()} data-testid="new-tree">
                  <Icon name="tree" size={30} stroke={2.4} />
                  <span>New tree</span>
                </button>
              )}
            </div>
          </>
        )}
      </section>

      {t.confirmMissing && (
        <Modal title="Some details are missing" onClose={() => tally.backToMeasure()} testId="confirm-missing">
          <p className="confirm-text">
            Missing: <b>{t.confirmMissing.map((k) => MISSING_LABEL(k, measure)).join(', ')}</b>.
          </p>
          <div className="confirm-actions">
            <button className="btn ghost big" onClick={() => tally.backToMeasure()} data-testid="confirm-back">
              Fill them in
            </button>
            <button className="btn primary big" onClick={() => void tally.getTag(true)} data-testid="confirm-tag">
              Tag anyway
            </button>
          </div>
        </Modal>
      )}

      {t.photoRequest && repo.tree(t.photoRequest.treeId) && (
        <Modal title="Photo" onClose={() => tally.photoDone(false)} testId="photo-sheet">
          <div className="photo-sheet-tag">{t.photoRequest.tag}</div>
          <p className="hint center">Get the tree and its flagging tape in the shot.</p>
          <PhotoButtons tree={repo.tree(t.photoRequest.treeId)!} onSaved={(ok) => tally.photoDone(ok)} />
        </Modal>
      )}

      {cardId && repo.tree(cardId) && <TreeCard tree={repo.tree(cardId)!} onClose={() => setCardId(null)} />}
    </div>
  );
}
