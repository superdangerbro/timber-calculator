import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TreeFields } from '@timber/core';
import { useApp } from '../app';
import { useEmitter } from '../lib/emitter';
import { Icon } from '../components/Icon';
import { GpsChip, SyncChip } from '../components/chips';
import { ClashBanner } from '../components/ClashBanner';
import { FieldEditor, FieldGrid, type FieldKey } from '../components/fields';
import { TreeMap } from '../map/TreeMap';
import { isToday } from '../state/repo';
import { money, safeSummary, safeValue, sawlogM3 } from '../lib/valuation';
import { usePressHandler } from '../Shell';
import type { TallyPhase } from '../state/tally';

const PHASE_LABEL: Record<TallyPhase, string> = {
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Thinking',
  readback: 'Reading back',
  saved: 'Saved',
};

function TagDisplay({ tag, fresh }: { tag: string | null; fresh: boolean }) {
  if (!tag)
    return (
      <div className="tag-hero empty" data-testid="last-tag">
        <div className="tag-caption">Next tree gets a tag on “save”</div>
      </div>
    );
  const parts = tag.split('-');
  const block = parts.length >= 3 ? parts[0] : null;
  const main = block ? parts.slice(1).join('-') : tag;
  return (
    <div className={fresh ? 'tag-hero fresh' : 'tag-hero'} data-testid="last-tag">
      <div className="tag-caption">
        {fresh ? 'Write on tape' : 'Last tag'}
        {block && <span className="tag-block">{block}</span>}
      </div>
      <div className="tag-big" data-testid="tag-big" style={{ fontSize: Math.min(116, Math.floor(404 / (main.length * 0.6))) }}>
        {main}
      </div>
    </div>
  );
}

export function TallyScreen({ onMeasure }: { onMeasure: () => void }) {
  const app = useApp();
  const { tally, repo, gps, platform } = app;
  const t = useEmitter(tally);
  const r = useEmitter(repo);
  const g = useEmitter(gps);
  const [editing, setEditing] = useState<FieldKey | null>(null);
  const [typed, setTyped] = useState('');
  const [showType, setShowType] = useState(!platform.native);
  const [manualSheet, setManualSheet] = useState<boolean | null>(null);
  const downAt = useRef<number | null>(null);
  const totalsRef = useRef<HTMLDivElement>(null);
  const [padTop, setPadTop] = useState(0);
  const startedByDown = useRef(false);

  usePressHandler(() => void tally.press());
  useEffect(() => setManualSheet(null), [t.phase]);
  useEffect(() => tally.resume(), [tally]);

  const today = useMemo(() => r.trees.filter((x) => isToday(x.createdAt)), [r.trees]);
  const scenario = repo.scenario;
  const summary = useMemo(() => safeSummary(today.filter((x) => !x.voided), scenario), [today, scenario]);
  const rings = useMemo(() => {
    const out: Record<string, string> = {};
    for (const x of today) if (!x.voided && safeValue(x, scenario).product === 'pole') out[x.id] = '#ff6b1a';
    return out;
  }, [today, scenario]);

  const draftEmpty = Object.keys(t.draft).length === 0;
  const autoExpanded = !draftEmpty || t.phase === 'listening' || t.phase === 'readback' || t.phase === 'thinking';
  const expanded = manualSheet ?? autoExpanded;
  useLayoutEffect(() => {
    const el = totalsRef.current;
    setPadTop(el && el.offsetParent ? el.offsetTop + el.offsetHeight : 0);
  });
  const position = g.averaging && g.averaged ? g.averaged : g.last;

  const onDown = () => {
    downAt.current = Date.now();
    startedByDown.current = t.phase === 'idle' || t.phase === 'saved';
    if (startedByDown.current) void tally.press();
  };
  const onUp = () => {
    const held = downAt.current ? Date.now() - downAt.current : 0;
    downAt.current = null;
    if (startedByDown.current) {
      // Hold-to-talk: releasing after a long press means "done talking".
      if (held > 450) void tally.press();
      startedByDown.current = false;
      return;
    }
    void tally.press();
  };

  const talkLabel =
    t.phase === 'idle'
      ? 'Talk'
      : t.phase === 'saved'
        ? 'Next tree'
        : t.phase === 'readback'
          ? 'Save tree'
          : t.phase === 'thinking'
            ? 'Thinking…'
            : draftEmpty
              ? 'Listening…'
              : 'Done talking';
  const talkSub =
    t.phase === 'readback'
      ? 'or say “save”'
      : t.phase === 'listening'
        ? 'say species, DBH, height…'
        : t.phase === 'saved'
          ? 'or just start talking'
          : 'press, click or hold';

  const submitTyped = (e: React.FormEvent) => {
    e.preventDefault();
    const text = typed.trim();
    if (!text) return;
    setTyped('');
    tally.submitText(text);
  };

  return (
    <div className={`tally ${expanded ? 'expanded' : 'collapsed'}`} data-phase={t.phase}>
      <div className="tally-map">
        <TreeMap
          trees={today}
          blocks={r.blocks}
          position={position ? { lat: position.lat, lon: position.lon, accuracyM: position.accuracyM } : null}
          labelIds={t.lastTreeId ? [t.lastTreeId] : []}
          rings={rings}
          padTop={padTop}
          testId="tally-map"
        />
        <div className="map-chips">
          <GpsChip />
          <SyncChip />
        </div>
        <div className="totals-overlay" data-testid="totals" ref={totalsRef}>
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
          <div>
            <b>{money(summary.totalValue)}</b>
            <span>value</span>
          </div>
        </div>
      </div>

      <section className="sheet" data-testid="sheet">
        <button
          className="sheet-handle"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={() => setManualSheet(!expanded)}
          onTouchStart={(e) => ((e.currentTarget as any)._y = e.touches[0].clientY)}
          onTouchEnd={(e) => {
            const y0 = (e.currentTarget as any)._y as number | undefined;
            const dy = y0 === undefined ? 0 : e.changedTouches[0].clientY - y0;
            if (dy < -20) setManualSheet(true);
            else if (dy > 20) setManualSheet(false);
          }}
        >
          <span />
        </button>

        <ClashBanner />

        {expanded ? (
          <div className="draft-head">
            <div className={`phase-pill ${t.phase}`} data-testid="phase">
              {(t.phase === 'listening' || t.phase === 'readback') && <span className="pulse" />}
              {t.phase === 'readback' && !t.speaking ? 'Say “save”' : PHASE_LABEL[t.phase]}
            </div>
            <div className="draft-head-tag">
              {t.lastTag ? (
                <>
                  last <b>{t.lastTag}</b>
                </>
              ) : null}
            </div>
            <button className="icon-btn" aria-label="Measure height" onClick={onMeasure} data-testid="open-measure">
              <Icon name="ruler" />
            </button>
          </div>
        ) : (
          <TagDisplay tag={t.lastTag} fresh={t.phase === 'saved' && !r.clashes.some((c) => c.tree.id === t.lastTreeId)} />
        )}

        {expanded && (
          <FieldGrid fields={t.draft} missing={draftEmpty ? [] : t.missing} onEdit={setEditing} />
        )}

        <div className="convo" data-testid="convo">
          <div className="convo-line heard">
            <Icon name="ear" size={18} />
            <span data-testid="heard">{t.partial || t.heard || <i>Say: “fir forty two, thirty metres, straight four…”</i>}</span>
          </div>
          <div className={`convo-line spoken${t.speaking ? ' live' : ''}`}>
            <Icon name="speaker" size={18} />
            <span data-testid="spoken">{t.spoken || <i>Readback appears here</i>}</span>
          </div>
          {t.notice && (
            <div className="convo-notice" data-testid="notice">
              {t.notice}
            </div>
          )}
        </div>

        {showType && (
          <form className="type-row" onSubmit={submitTyped}>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type what you'd say"
              enterKeyHint="send"
              autoCapitalize="off"
              autoCorrect="off"
              data-testid="type-input"
            />
            <button type="submit" className="type-send" aria-label="Send" data-testid="type-send">
              <Icon name="send" size={22} />
            </button>
          </form>
        )}

        <div className="talk-row">
          {platform.native && (
            <button className="side-btn" aria-label="Type instead" onClick={() => setShowType((v) => !v)}>
              <Icon name="keyboard" />
            </button>
          )}
          <button
            className={`talk-btn ${t.phase}`}
            onPointerDown={onDown}
            onPointerUp={onUp}
            onPointerCancel={() => (downAt.current = null)}
            onContextMenu={(e) => e.preventDefault()}
            data-testid="talk"
          >
            <Icon name={t.phase === 'readback' ? 'check' : 'mic'} size={34} stroke={2.6} />
            <span className="talk-text">
              <span className="talk-label">{talkLabel}</span>
              <span className="talk-sub">{talkSub}</span>
            </span>
          </button>
        </div>
      </section>

      {editing && (
        <FieldEditor
          field={editing}
          value={t.draft}
          onChange={(patch: TreeFields) => tally.setField(patch)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
