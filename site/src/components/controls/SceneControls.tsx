import { useEffect, useRef } from 'react';
import { live, requestFrame, resetView, ui, useUi, type SceneName } from '../../state/sceneStore';

const SCENE_NAME: Record<SceneName, string> = {
  hero: 'Signal Field',
  matrix: 'Matrix surface',
  pipeline: 'Pipeline engine',
};

const clampZoom = (z: number) => Math.min(1.8, Math.max(0.6, z));

/** Floating bar for the 3D scenes: Interact (drag/zoom), Pause/Resume, Reset. */
export function SceneControls() {
  const scene = useUi((s) => s.activeScene);
  const paused = useUi((s) => s.paused);
  const interact = useUi((s) => s.interact);
  const webgl = useUi((s) => s.webgl);
  const reduced = useUi((s) => s.reducedMotion);

  // Leaving every 3D scene turns Interact off, so it never traps the page.
  useEffect(() => { if (!scene && interact) ui.set({ interact: false }); }, [scene, interact]);

  if (!webgl) return null;
  const visible = scene !== null;
  return (
    <>
      <div className={`scene-controls${visible ? ' is-visible' : ''}`} role="toolbar" aria-label="3D scene controls" aria-hidden={!visible}>
        <span className="scene-controls__name label">{scene ? SCENE_NAME[scene] : '3D'}</span>
        <button type="button" className="ctl" aria-label="Interact with the 3D scene" aria-pressed={interact} tabIndex={visible ? 0 : -1}
                onClick={() => ui.set({ interact: !interact })}
                title="Drag to rotate, wheel or +/− to zoom, arrows to rotate, Esc to exit">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v13M1.5 8h13M8 1.5 6 3.5M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2" /></svg>
          <span className="ctl__t">{interact ? 'Interacting' : 'Interact'}</span>
        </button>
        <button type="button" className="ctl" aria-label={paused ? 'Resume animation' : 'Pause animation'} aria-pressed={paused} tabIndex={visible ? 0 : -1}
                onClick={() => { ui.set({ paused: !paused }); requestFrame(); }}>
          {paused
            ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3v10l8.5-5z" /></svg>
            : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10M11 3v10" /></svg>}
          <span className="ctl__t">{paused ? 'Resume' : 'Pause'}</span>
        </button>
        <button type="button" className="ctl" aria-label="Reset the 3D view" tabIndex={visible ? 0 : -1} onClick={resetView}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5v2.8h2.8" /></svg>
          <span className="ctl__t">Reset</span>
        </button>
        {reduced && paused && <span className="scene-controls__note">Reduced motion: still frame</span>}
      </div>
      {interact && scene && <InteractLayer scene={scene} />}
      <p className="visually-hidden" aria-live="polite">{interact ? `Interact mode on for the ${scene ? SCENE_NAME[scene] : ''}. Drag to rotate, use the wheel to zoom, press Escape to exit.` : ''}</p>
    </>
  );
}

/** A transparent layer that captures drags and wheel only while Interact mode is on. */
function InteractLayer({ scene }: { scene: SceneName }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current!;
    let dragging = false, lx = 0, ly = 0;
    const down = (e: PointerEvent) => { dragging = true; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId); el.classList.add('is-dragging'); };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const r = live.rot[scene];
      r.y += (e.clientX - lx) * 0.006;
      r.x = Math.max(-1.1, Math.min(1.1, r.x + (e.clientY - ly) * 0.006));
      lx = e.clientX; ly = e.clientY;
      requestFrame();
    };
    const up = () => { dragging = false; el.classList.remove('is-dragging'); };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      live.zoom[scene] = clampZoom(live.zoom[scene] * (e.deltaY > 0 ? 0.94 : 1.06));
      requestFrame();
    };
    const key = (e: KeyboardEvent) => {
      const r = live.rot[scene];
      if (e.key === 'Escape') ui.set({ interact: false });
      else if (e.key === 'ArrowLeft') r.y -= 0.12;
      else if (e.key === 'ArrowRight') r.y += 0.12;
      else if (e.key === 'ArrowUp') r.x = Math.max(-1.1, r.x - 0.12);
      else if (e.key === 'ArrowDown') r.x = Math.min(1.1, r.x + 0.12);
      else if (e.key === '+' || e.key === '=') live.zoom[scene] = clampZoom(live.zoom[scene] * 1.08);
      else if (e.key === '-') live.zoom[scene] = clampZoom(live.zoom[scene] * 0.92);
      else return;
      e.preventDefault();
      requestFrame();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', key);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', key);
    };
  }, [scene]);

  return (
    <div ref={ref} className="interact-layer" aria-hidden="true">
      <span className="interact-layer__hint label">Drag to rotate · wheel to zoom · click a hotspot · Esc to exit</span>
    </div>
  );
}
