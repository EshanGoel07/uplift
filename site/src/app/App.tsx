import { Component, lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Summary } from '../data/types';
import { loadSummary } from '../data/load';
import { FEATURED_TASK } from '../data/reportFigures';
import { BackToTop, Nav, jumpTo } from '../components/navigation/Nav';
import { ui, useUi } from '../state/sceneStore';
import { scheduleRefresh } from '../hooks/useGsap';
import { Hero } from '../sections/Hero/Hero';
import { Results } from '../sections/Results/Results';
import { BugMatrix } from '../sections/BugMatrix/BugMatrix';
import { BugExplorer } from '../sections/BugExplorer/BugExplorer';
import { WorkedExample } from '../sections/WorkedExample/WorkedExample';
import { Trust } from '../sections/Trust/Trust';
import { Methodology } from '../sections/Methodology/Methodology';
import { BuiltVsUsed } from '../sections/BuiltVsUsed/BuiltVsUsed';
import { Limitations } from '../sections/Limitations/Limitations';
import { FutureWork } from '../sections/FutureWork/FutureWork';
import { Footer } from '../sections/Footer/Footer';

// three.js, R3F and the shaders load in their own chunk, only when a section with a 3D scene approaches.
const ExperienceCanvas = lazy(() => import('../scenes/ExperienceCanvas'));

/** If WebGL fails at runtime (no context, lost driver), fall back to the static poster. */
class WebGLBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { ui.set({ webgl: false, activeScene: null }); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function App() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string>(FEATURED_TASK);
  const webgl = useUi((s) => s.webgl);
  // The hero and findings carry no WebGL. The 3D layer (method and matrix scenes) mounts only when
  // one of those sections comes within about a screen of the viewport.
  const [mount3d, setMount3d] = useState(false);
  useEffect(() => {
    if (!webgl || mount3d) return;
    const targets = ['method'].map((id) => document.getElementById(id)).filter((el): el is HTMLElement => !!el);
    if (!targets.length) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setMount3d(true); io.disconnect(); }
    }, { rootMargin: '100% 0px' });
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [webgl, mount3d]);

  useEffect(() => {
    loadSummary().then(setSummary).catch((e: Error) => setError(e.message));
  }, []);

  // Trigger positions depend on layout: refresh once data and fonts are in.
  useEffect(() => { if (summary) scheduleRefresh(60); }, [summary]);
  useEffect(() => { document.fonts?.ready.then(() => scheduleRefresh(60)); }, []);

  const openTask = useCallback((id: string) => {
    setTaskId(id);
    requestAnimationFrame(() => jumpTo('explorer-all'));
  }, []);

  return (
    <>
      <Nav />
      {webgl && mount3d && (
        <WebGLBoundary>
          <Suspense fallback={null}>
            <ExperienceCanvas summary={summary} />
          </Suspense>
        </WebGLBoundary>
      )}
      <main id="main">
        <Hero summary={summary} onOpenTask={openTask} />
        {error && <p className="pub-container load-error" role="alert">Could not load the study data ({error}). The raw file is at <a href="./data/results.json">data/results.json</a>.</p>}
        <Results summary={summary} />
        <Methodology summary={summary} onOpenTask={openTask} />
        <WorkedExample summary={summary} />
        <BugMatrix summary={summary} onOpenTask={openTask} selectedTask={taskId} />
        <BugExplorer summary={summary} taskId={taskId} onSelectTask={setTaskId} />
        <Trust summary={summary} />
        <BuiltVsUsed />
        <Limitations />
        <FutureWork />
      </main>
      <Footer />
      <BackToTop />
    </>
  );
}
