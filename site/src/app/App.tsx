import { Component, lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Summary } from '../data/types';
import { loadSummary } from '../data/load';
import { atlas, selectTask, useAtlas } from '../state/atlasStore';
import { CommandPalette } from '../components/atlas/CommandPalette';
import { ComparisonTray, InspectorPanel } from '../components/atlas/Inspector';
import { SectionProgress } from '../components/atlas/SectionProgress';
import { nebulaDom } from '../state/nebulaStore';
import { BackToTop, Nav, jumpTo } from '../components/navigation/Nav';
import { scenes, ui, useScenes, useUi } from '../state/sceneStore';
import { Hero } from '../sections/Hero/Hero';
import { Results } from '../sections/Results/Results';
import { BugMatrix } from '../sections/BugMatrix/BugMatrix';
import { BugExplorer } from '../sections/BugExplorer/BugExplorer';
import { WorkedExample } from '../sections/WorkedExample/WorkedExample';
import { Trust } from '../sections/Trust/Trust';
import { GuidedTour } from '../components/atlas/GuidedTour';
import { Conditions } from '../sections/Conditions/Conditions';
import { Methodology } from '../sections/Methodology/Methodology';
import { BuiltVsUsed } from '../sections/BuiltVsUsed/BuiltVsUsed';
import { Limitations } from '../sections/Limitations/Limitations';
import { FutureWork } from '../sections/FutureWork/FutureWork';
import { Footer } from '../sections/Footer/Footer';

// three.js, R3F and the shaders load in their own chunk, once a section requests a 3D scene.
const ExperienceCanvas = lazy(() => import('../scenes/ExperienceCanvas'));
const Architecture = lazy(() => import('../sections/Architecture/Architecture').then((m) => ({ default: m.Architecture })));

/** If WebGL fails at runtime (no context, lost driver), every section falls back to its SVG/HTML version. */
class WebGLBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { ui.set({ webgl: false, activeScene: null }); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function App() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const taskId = useAtlas((s) => s.task);
  const view = useAtlas((s) => s.view);
  useEffect(() => { document.documentElement.dataset.view = view; }, [view]);
  const webgl = useUi((s) => s.webgl);
  // The one canvas mounts when a section first requests a scene, and stays: it is a single persistent
  // renderer, and scenes come and go inside it.
  const wanted = useScenes(() => scenes.list().some((e) => e.requested));
  const [mount3d, setMount3d] = useState(false);
  useEffect(() => { if (wanted) setMount3d(true); }, [wanted]);

  useEffect(() => {
    loadSummary().then(setSummary).catch((e: Error) => setError(e.message));
  }, []);

  const openTask = useCallback((id: string) => {
    atlas.set({ task: id }, 'push');
    requestAnimationFrame(() => jumpTo('explorer-all'));
  }, []);

  return (
    <>
      <Nav />
      <SectionProgress />
      {webgl && mount3d && (
        <WebGLBoundary>
          <Suspense fallback={null}>
            <ExperienceCanvas summary={summary} />
          </Suspense>
        </WebGLBoundary>
      )}
      <main id="main">
        <Hero summary={summary} />
        {error && <p className="pub-container load-error" role="alert">Could not load the study data ({error}). The raw file is at <a href="./data/results.json">data/results.json</a>.</p>}
        <Results summary={summary} />
        <Conditions summary={summary} />
        <Methodology summary={summary} onOpenTask={openTask} />
        <WorkedExample summary={summary} />
        <BugMatrix summary={summary} onOpenTask={openTask} selectedTask={taskId} />
        <BugExplorer summary={summary} taskId={taskId} onSelectTask={selectTask} />
        <Suspense fallback={<div className="pub-skeleton pub-skeleton--matrix" />}><Architecture summary={summary} /></Suspense>
        <Trust summary={summary} />
        <BuiltVsUsed />
        <Limitations />
        <FutureWork />
      </main>
      <Footer />
      <BackToTop />
      <InspectorPanel summary={summary} />
      <ComparisonTray summary={summary} />
      <CommandPalette summary={summary} />
      <GuidedTour />
      <svg className="thread" aria-hidden="true"><line ref={(el) => { nebulaDom.thread = el; }} visibility="hidden" /></svg>
    </>
  );
}
