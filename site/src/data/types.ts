// Shapes of site/public/data/*.json. All rates and differences are fractions (0.727 = 72.7%).

export type ArmId = 'none' | 'prose' | 'sensors' | 'both' | 'handwritten' | 'tuned';
export type TaskSet = 'test' | 'fresh';
export type Group = 'always' | 'mixed' | 'never';

export interface Arm {
  id: ArmId;
  label: string;
  solved: number;
  attempts: number;
  rate: number;
  diff_vs_none: number;
  ci_low: number;
  ci_high: number;
  cost_per_solved: number;
  regressions: number;
}

export interface TrustCard { title: string; detail: string }

export interface StudySummary {
  runs: number;
  tasks: number;
  total_cost_usd: number;
  agent: string;
  repo: string;
}

export interface TaskMeta {
  id: string;
  set: TaskSet;
  title: string;
  solved: Record<ArmId, number>;
  total: number;
  group: Group;
  hooksFired: boolean;
  cost: number;
}

export interface Summary {
  summary: StudySummary;
  arms: Arm[];
  trust: TrustCard[];
  tasks: TaskMeta[];
}

export interface Run {
  seed: number;
  resolved: boolean;
  cost_usd: number;
  diff: string;
  hooks: string[];
}

export interface Task {
  id: string;
  set: TaskSet;
  title: string;
  issue: string;
  results: Record<ArmId, { solved: number; runs: Run[] }>;
}
