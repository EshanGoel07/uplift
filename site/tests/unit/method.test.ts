// The workbench's structural facts (src/data/method.ts) must match the pipeline's own source code.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AGENT_PROMPT, CONDITIONS, STRIPPED_AGENT_FILES } from '../../src/data/method';

const repo = resolve(__dirname, '../../..');
// Normalise line endings: on Windows the Python sources may be checked out with CRLF.
const py = (p: string) => readFileSync(resolve(repo, p), 'utf-8').replace(/\r\n/g, '\n');

describe('method facts match the Python pipeline', () => {
  it('the agent prompt is runner.PROMPT verbatim', () => {
    const m = py('src/uplift/runner.py').match(/PROMPT = """([\s\S]*?)"""/);
    expect(m).not.toBeNull();
    expect(AGENT_PROMPT).toBe(m![1].trimEnd());
  });

  it('the stripped agent files are workspace.AGENT_PATHS', () => {
    const m = py('src/uplift/workspace.py').match(/AGENT_PATHS = \[([\s\S]*?)\]/);
    const paths = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(STRIPPED_AGENT_FILES).toEqual(paths);
  });

  it('tips and hooks per condition agree with generate.ARMS', () => {
    const src = py('src/uplift/generate.py');
    for (const arm of ['none', 'prose', 'sensors', 'both'] as const) {
      const m = src.match(new RegExp(String.raw`"${arm}": \((True|False), \[([^\]]*)\]\)`));
      expect(m, arm).not.toBeNull();
      expect(CONDITIONS[arm].hasTips, arm).toBe(m![1] === 'True');
      expect(CONDITIONS[arm].hasHooks, arm).toBe(m![2].trim().length > 0);
    }
  });

  it('the generic file is the 60-line arms/handwritten/AGENTS.md', () => {
    const lines = py('arms/handwritten/AGENTS.md').split('\n').filter((l, i, a) => i < a.length - 1 || l !== '').length;
    expect(lines).toBe(60);
    expect(CONDITIONS.handwritten.receives[0]).toContain('60-line');
  });
});
