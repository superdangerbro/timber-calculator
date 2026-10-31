import { useEffect, useRef, useState } from 'react';
import { heightFromAngles, parseUtterance } from '@timber/core';
import { useApp } from '../app';
import { Icon } from '../components/Icon';
import { usePressHandler } from '../Shell';
import { orientationNeedsPermission, requestOrientationPermission } from '../platform/motion';

type Step = 'base' | 'top' | 'done';

/** Spoken distance: "twenty", "distance 18", "15 m". */
function parseDistance(text: string): number | null {
  const digits = /(\d+(?:\.\d+)?)/.exec(text);
  if (digits) return parseFloat(digits[1]);
  try {
    const r = parseUtterance(text);
    const n = r.fields.heightM ?? r.fields.dbhCm;
    return typeof n === 'number' ? n : null;
  } catch {
    return null;
  }
}

export function MeasureScreen({ onClose }: { onClose: () => void }) {
  const { platform, tally } = useApp();
  const [pitch, setPitch] = useState(0);
  const [sensor, setSensor] = useState(false);
  const [distance, setDistance] = useState('15');
  const [step, setStep] = useState<Step>('base');
  const [baseDeg, setBaseDeg] = useState<number | null>(null);
  const [topDeg, setTopDeg] = useState<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [heard, setHeard] = useState('');
  const [typed, setTyped] = useState('');
  const [camera, setCamera] = useState(false);
  const [motionKey, setMotionKey] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const pitchRef = useRef(0);
  pitchRef.current = pitch;
  const stateRef = useRef({ step, baseDeg, distance, height });
  stateRef.current = { step, baseDeg, distance, height };

  // Motion sensor (falls back to the slider when no events arrive).
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    platform.motion
      .start((o) => {
        setSensor(true);
        setPitch(Math.round(o.pitchDeg * 10) / 10);
      })
      .then((s) => {
        if (cancelled) s();
        else stop = s;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [platform, motionKey]);

  // Camera behind the crosshair, if there is one.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    const md = navigator.mediaDevices;
    if (md?.getUserMedia) {
      md.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        .then((s) => {
          if (cancelled) {
            s.getTracks().forEach((t) => t.stop());
            return;
          }
          stream = s;
          if (video.current) {
            video.current.srcObject = s;
            void video.current.play().catch(() => undefined);
          }
          setCamera(true);
        })
        .catch(() => setCamera(false));
    }
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const mark = () => {
    const s = stateRef.current;
    const p = pitchRef.current;
    if (s.step === 'base') {
      setBaseDeg(p);
      setStep('top');
      void platform.tts.speak('Base marked. Aim at the top.');
    } else if (s.step === 'top') {
      const d = parseFloat(s.distance);
      const base = s.baseDeg ?? 0;
      let h: number;
      try {
        h = heightFromAngles({ distanceM: d, topDeg: p, baseDeg: base });
      } catch {
        h = Math.round(d * (Math.tan((p * Math.PI) / 180) - Math.tan((base * Math.PI) / 180)) * 10) / 10;
      }
      setTopDeg(p);
      setHeight(h);
      setStep('done');
      void platform.tts.speak(`Height ${h} metres.`);
    } else if (s.step === 'done' && s.height != null) {
      use(s.height);
    }
  };

  const use = (h: number) => {
    onClose();
    void tally.setHeight(h);
  };

  const redo = () => {
    setStep('base');
    setBaseDeg(null);
    setTopDeg(null);
    setHeight(null);
  };

  const handleUtterance = (text: string) => {
    setHeard(text);
    const t = text.toLowerCase();
    if (/\b(cancel|close|back)\b/.test(t)) return onClose();
    if (/\b(redo|again|reset)\b/.test(t)) return redo();
    if (/\b(distance|metres|meters|m)\b/.test(t) || /^\s*[\d.]+\s*$/.test(t)) {
      const d = parseDistance(t);
      if (d && d > 0 && d < 200) {
        setDistance(String(d));
        void platform.tts.speak(`Distance ${d} metres.`);
        return;
      }
    }
    if (/\b(base|bottom|top|mark|use|save|ok|okay)\b/.test(t)) return mark();
  };

  // Voice while measuring.
  useEffect(() => {
    void platform.speech.start({ onFinal: handleUtterance }, ['base', 'top', 'mark', 'distance', 'metres', 'redo', 'cancel', 'use']);
    return () => {
      void platform.speech.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  usePressHandler(mark);

  const prompt = step === 'base' ? 'Aim crosshair at the BASE' : step === 'top' ? 'Aim crosshair at the TOP' : 'Height measured';
  const action = step === 'base' ? 'Mark base' : step === 'top' ? 'Mark top' : `Use ${height?.toFixed(1)} m`;

  return (
    <div className="measure" data-testid="measure">
      <video ref={video} className={camera ? 'measure-video on' : 'measure-video'} playsInline muted />
      <div className="measure-shade" />
      <div className="crosshair" aria-hidden="true">
        <div className="ch-h" />
        <div className="ch-v" />
        <div className="ch-ring" />
      </div>

      <header className="measure-top">
        <button className="icon-btn glass" aria-label="Close" onClick={onClose} data-testid="measure-close">
          <Icon name="x" />
        </button>
        <div className="measure-title">Measure height</div>
        <div className="steps">
          <span className={step === 'base' ? 'on' : baseDeg != null ? 'done' : ''}>1</span>
          <span className={step === 'top' ? 'on' : topDeg != null ? 'done' : ''}>2</span>
        </div>
      </header>

      <div className="angle-readout" data-testid="angle">
        <div className="angle-big">
          {pitch >= 0 ? '+' : '−'}
          {Math.abs(pitch).toFixed(1)}°
        </div>
        <div className="angle-prompt">{prompt}</div>
      </div>

      <div className="measure-panel">
        <div className="measure-stats">
          <div>
            <span>Base</span>
            <b data-testid="base-deg">{baseDeg == null ? '—' : `${baseDeg.toFixed(1).replace('-', '−')}°`}</b>
          </div>
          <div>
            <span>Top</span>
            <b data-testid="top-deg">{topDeg == null ? '—' : `${topDeg.toFixed(1).replace('-', '−')}°`}</b>
          </div>
          <div className="measure-height">
            <span>Height</span>
            <b data-testid="height-result">{height == null ? "—" : `${height.toFixed(1)} m`}</b>
          </div>
        </div>

        <div className="distance-row">
          <span className="distance-label">Distance to tree</span>
          <button className="step-btn" onClick={() => setDistance(String(Math.max(1, (parseFloat(distance) || 15) - 1)))} aria-label="Closer">
            −
          </button>
          <div className="distance-input">
            <input
              inputMode="decimal"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              data-testid="distance"
            />
            <span>m</span>
          </div>
          <button className="step-btn" onClick={() => setDistance(String((parseFloat(distance) || 15) + 1))} aria-label="Farther">
            +
          </button>
        </div>

        {!sensor && orientationNeedsPermission() && (
          <button
            className="btn ghost wide"
            onClick={async () => {
              await requestOrientationPermission();
              setMotionKey((k) => k + 1);
            }}
          >
            Enable tilt sensor
          </button>
        )}
        {!sensor && !platform.native && (
          <label className="sim-slider">
            <span>Simulated tilt (no motion sensor)</span>
            <input
              type="range"
              min={-60}
              max={85}
              step={0.5}
              value={pitch}
              onChange={(e) => setPitch(parseFloat(e.target.value))}
              data-testid="pitch-slider"
            />
          </label>
        )}

        <form
          className="type-row small"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) handleUtterance(typed.trim());
            setTyped('');
          }}
        >
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={heard ? `heard: ${heard}` : 'Say “distance 20”, “base”, “top”'}
            data-testid="measure-type"
          />
          <button type="submit" className="type-send" aria-label="Send">
            <Icon name="send" size={20} />
          </button>
        </form>

        <div className="measure-actions">
          {step !== 'base' && (
            <button className="btn ghost big" onClick={redo}>
              Redo
            </button>
          )}
          <button className="btn primary big grow" onClick={mark} data-testid="mark">
            {action}
          </button>
        </div>
      </div>
    </div>
  );
}
