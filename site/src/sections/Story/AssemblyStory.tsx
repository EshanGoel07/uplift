import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { Model } from '../../state/assemblyStore';
import { assemblies, setAssembly, useAssembly, type AssemblyId } from '../../state/assemblyStore';
import { useMedia, WIDE } from '../../hooks/useMedia';
import { Icon } from '../../components/atlas/Icon';
import { ToolButton } from '../../components/atlas/Primitives';
import { StoryScroller, type StoryStep } from '../../components/story/StoryScroller';
import { requestFrame, scenes, useScenes, useUi, type SceneId } from '../../state/sceneStore';
import { AssemblyFigure } from './AssemblyFigure';

interface Props {
  id: AssemblyId;
  sectionId: string;
  eyebrow: string;
  title: string;
  lead: ReactNode;
  steps: StoryStep[];
  states: readonly string[];
  model: Model;
  /** Extra controls, such as a condition picker. They sit on the stage, so using them never moves the reader. */
  controls?: ReactNode;
}

/**
 * One 3D story model in its vertical story. The stage shows the model, a keyboard-reachable list of its
 * parts and an explanation of the selected part, so nothing depends on the pointer. Without WebGL, on
 * phones, or while the scene loads, the 2D figure shows the same parts from the same data.
 */
export function AssemblyStory({ id, sectionId, eyebrow, title, lead, steps, states, model, controls }: Props) {
  const webgl = useUi((s) => s.webgl);
  const failed = useUi((s) => s.assembly3dFailed);
  const reduced = useUi((s) => s.reducedMotion);
  const wide = useMedia(WIDE);
  const use3d = webgl && wide && !failed;
  const stage = useRef<HTMLDivElement>(null);
  const sceneId = id as SceneId;
  const mounted = useScenes(() => scenes.get(sceneId).mounted);
  const state = useAssembly(() => assemblies[id].state);
  const selected = useAssembly(() => assemblies[id].selected);

  useEffect(() => { setAssembly(id, { model }); }, [id, model]);
  useEffect(() => { setAssembly(id, { reduced }); }, [id, reduced]);
  useEffect(() => {
    const el = stage.current;
    if (!use3d || !el) return;
    let release: (() => void) | undefined;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !release) release = scenes.request(sceneId, el, { reducedMotion: 'static', lowTier: false });
    }, { rootMargin: '500px 0px' });
    io.observe(el);
    return () => { io.disconnect(); release?.(); };
  }, [use3d, sceneId]);

  // A selected part that the story has not introduced yet, or has left, stops being selected.
  useEffect(() => {
    const part = model.parts.find((p) => p.id === selected);
    if (selected && (!part || (part.poses[state]?.on ?? 0) < 0.5)) setAssembly(id, { selected: null });
  }, [id, model, selected, state]);

  // Dragging turns the model a little around the story's view, within limits that keep it readable.
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || e.target !== e.currentTarget) return;
    const a = assemblies[id];
    drag.current = { x: e.clientX, y: e.clientY, yaw: a.yaw, pitch: a.pitch };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const yaw = Math.max(-0.9, Math.min(0.9, d.yaw - (e.clientX - d.x) * 0.005));
    const pitch = Math.max(-0.3, Math.min(0.5, d.pitch + (e.clientY - d.y) * 0.004));
    setAssembly(id, { yaw, pitch });
  };
  const onUp = () => { drag.current = null; };
  const reset = useCallback(() => { setAssembly(id, { yaw: 0, pitch: 0, selected: null }); requestFrame('state'); }, [id]);
  const onStep = useCallback((i: number) => setAssembly(id, { state: i }), [id]);

  const present = model.parts.filter((p) => (p.poses[state]?.on ?? 0) > 0.5);
  const part = model.parts.find((p) => p.id === selected);

  return (
    <section id={sectionId} className="pub onebug assembly" aria-labelledby={`${sectionId}-title`}>
      <div className="pub-container">
        <header className="pub-head">
          <p className="pub-eyebrow">{eyebrow}</p>
          <h2 id={`${sectionId}-title`} className="pub-title">{title}</h2>
          <p className="pub-lead">{lead}</p>
        </header>
        {controls && !wide && <div className="assembly__controls">{controls}</div>}
      </div>
      <StoryScroller
        label={title}
        steps={steps}
        sticky={wide}
        states={states}
        onStep={onStep}
        stage={(active) => (
          <>
            <div className="story__canvas" ref={stage} aria-hidden="true" data-scene={id}
                 onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
              {(!use3d || !mounted) && <AssemblyFigure model={model} state={active} title={steps[active].title} />}
              {use3d && (
                <div className="story__labels">
                  <span className={`story__label${part ? ' is-on' : ''}`} ref={(el) => { assemblies[id].label = el; }}>{part?.title ?? ''}</span>
                </div>
              )}
            </div>
            <div className="assembly__inspect">
              {controls}
              <ul className="assembly__parts" aria-label="Parts of this model">
                {present.map((p) => (
                  <li key={p.id}>
                    <button type="button" aria-pressed={selected === p.id} onClick={() => setAssembly(id, { selected: selected === p.id ? null : p.id })}>{p.title}</button>
                  </li>
                ))}
              </ul>
              {part && (
                <div className="assembly__detail" role="status">
                  <p className="assembly__detail-title">{part.title}</p>
                  <p>{part.detail}</p>
                  {part.source && <p className="assembly__source"><Icon name="source" size={13} /><code>{part.source}</code></p>}
                </div>
              )}
              {use3d && <ToolButton icon="reset" onClick={reset}>Reset view</ToolButton>}
            </div>
          </>
        )}
        figure={(i) => <AssemblyFigure model={model} state={i} title={steps[i].title} />}
      />
    </section>
  );
}
