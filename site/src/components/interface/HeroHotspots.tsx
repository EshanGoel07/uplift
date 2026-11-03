import type { Summary } from '../../data/types';
import { heroHotspots } from '../../scenes/SignalField/hotspots';
import { hotspotRefs } from '../../scenes/SignalField/hotspotRegistry';
import { ui, useUi } from '../../state/sceneStore';

/** Real, focusable counters that float around the Signal Field. Positions are written by the scene. */
export function HeroHotspots({ summary }: { summary: Summary | null }) {
  const open = useUi((s) => s.hotspot);
  const spots = heroHotspots(summary);
  return (
    <div className="hotspots" ref={(el) => { hotspotRefs.layer = el; }} style={{ visibility: 'hidden' }}>
      {spots.map((h, i) => (
        <button key={h.label} type="button" className="hotspot" aria-expanded={open === i}
                ref={(el) => { hotspotRefs.items[i] = el; }}
                onClick={() => ui.set({ hotspot: open === i ? null : i })}>
          <span className="hotspot__v">{h.value}</span>
          <span className="hotspot__l">{h.label}</span>
        </button>
      ))}
    </div>
  );
}
