/** The fields of the study data the lattice layout depends on (structural, so tests can use summary.json directly). */
export interface TaskLike { set: string; solved: Record<string, number> }
export interface ArmLike { id: string; attempts: number }
