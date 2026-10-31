import { iteratedLocalSearch } from './localSearch';
import { PathProblem, pathCost } from './pathProblem';

/**
 * Concorde-style exact solver: LP relaxation + cutting planes + branch-and-bound, with the LP/MIP
 * engine provided by HiGHS (compiled to WebAssembly).
 *
 * Formulation (directed, so asymmetric matrices and open paths need no transformation):
 *   x_ij ∈ {0,1} for every arc i -> j that a source -> sink Hamiltonian path may use.
 *   out-degree(i) = 1 for i ≠ sink, in-degree(j) = 1 for j ≠ source.
 *   Connectivity cuts: for every set S with source ∈ S and S ≠ V, x(δ+(S)) ≥ 1.
 * Connectivity cuts are exponential in number, so they are generated lazily:
 *   1. Root cutting-plane loop on the LP relaxation, separating violated cuts exactly with
 *      max-flow / min-cut from the source to every node (as Concorde does with subtour cuts).
 *   2. MIP loop: HiGHS branch-and-bound on the strengthened model; if the integer solution
 *      contains a disconnected cycle, its cut is added and the MIP solved again.
 * The iterated-local-search tour gives the initial upper bound (cutoff), and the root LP value
 * gives a valid lower bound, so even a time-limited run reports a proven optimality gap.
 */

/** Minimal subset of the `highs` package API used here (keeps the solver testable). */
export interface HighsLike {
  solve(
    problem: string,
    options?: Record<string, string | number | boolean>
  ): { Status: string; ObjectiveValue: number; Columns: Record<string, { Primal?: number }> };
}

export interface BranchAndCutOptions {
  timeLimitMs?: number;
  /** Initial tour (e.g. from the heuristic); computed if omitted. */
  initialPath?: number[];
  onProgress?: (progress: BranchAndCutProgress) => void;
}

export interface BranchAndCutProgress {
  phase: 'root' | 'mip';
  lowerBound: number;
  upperBound: number;
  cuts: number;
}

export interface BranchAndCutResult {
  path: number[];
  cost: number;
  lowerBound: number;
  provenOptimal: boolean;
  cuts: number;
  mipRounds: number;
}

const EPS = 1e-6;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const varName = (i: number, j: number) => 'x' + i + '_' + j;

const formatTerms = (terms: string[]): string => {
  // Keep LP-format lines reasonably short.
  const lines: string[] = [];
  for (let k = 0; k < terms.length; k += 8) lines.push('  ' + terms.slice(k, k + 8).join(' '));
  return lines.join('\n');
};

const formatCoefficient = (value: number) => (Number.isInteger(value) ? String(value) : value.toPrecision(15));

export const solveBranchAndCut = (
  problem: PathProblem,
  highs: HighsLike,
  options: BranchAndCutOptions = {}
): BranchAndCutResult => {
  const { cost, size, source, sink } = problem;
  const deadline = now() + (options.timeLimitMs ?? 20000);

  let bestPath = options.initialPath ?? iteratedLocalSearch(problem, { timeLimitMs: 500 });
  let bestCost = pathCost(bestPath, cost);
  if (size <= 3) {
    return { path: bestPath, cost: bestCost, lowerBound: bestCost, provenOptimal: true, cuts: 0, mipRounds: 0 };
  }

  const arcs: [number, number][] = [];
  for (let i = 0; i < size; i += 1) {
    if (i === sink) continue;
    for (let j = 0; j < size; j += 1) {
      if (j === source || j === i) continue;
      if (i === source && j === sink) continue; // would skip every other node
      arcs.push([i, j]);
    }
  }

  const baseConstraints: string[] = [];
  for (let i = 0; i < size; i += 1) {
    if (i !== sink) {
      const terms = arcs.filter(([a]) => a === i).map(([a, b]) => '+ ' + varName(a, b));
      baseConstraints.push(' out' + i + ':\n' + formatTerms(terms) + ' = 1');
    }
    if (i !== source) {
      const terms = arcs.filter(([, b]) => b === i).map(([a, b]) => '+ ' + varName(a, b));
      baseConstraints.push(' in' + i + ':\n' + formatTerms(terms) + ' = 1');
    }
  }
  // 2-cycle elimination between inner nodes (cheap, very effective first cuts).
  for (let i = 0; i < size; i += 1) {
    for (let j = i + 1; j < size; j += 1) {
      if (i === source || i === sink || j === source || j === sink) continue;
      baseConstraints.push(' two' + i + '_' + j + ': ' + varName(i, j) + ' + ' + varName(j, i) + ' <= 1');
    }
  }

  const cuts: string[] = [];
  const cutKeys = new Set<string>();
  const addCut = (inSet: boolean[]) => {
    const key = inSet.map((v) => (v ? '1' : '0')).join('');
    if (cutKeys.has(key)) return false;
    cutKeys.add(key);
    const terms: string[] = [];
    for (const [a, b] of arcs) if (inSet[a] && !inSet[b]) terms.push('+ ' + varName(a, b));
    cuts.push(' cut' + cuts.length + ':\n' + formatTerms(terms) + ' >= 1');
    return true;
  };

  const objectiveTerms = arcs
    .filter(([a, b]) => cost[a][b] !== 0)
    .map(([a, b]) => '+ ' + formatCoefficient(cost[a][b]) + ' ' + varName(a, b));
  const objective = 'Minimize\n obj:\n' + (objectiveTerms.length ? formatTerms(objectiveTerms) : '  0 ' + varName(arcs[0][0], arcs[0][1]));
  const bounds = 'Bounds\n' + arcs.map(([a, b]) => ' 0 <= ' + varName(a, b) + ' <= 1').join('\n');

  const buildModel = (integer: boolean) =>
    [
      objective,
      'Subject To',
      ...baseConstraints,
      ...cuts,
      bounds,
      integer ? 'Binary\n' + formatTerms(arcs.map(([a, b]) => varName(a, b))) : '',
      'End',
    ].join('\n');

  const readSolution = (columns: Record<string, { Primal?: number }>) => {
    const x: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));
    for (const [a, b] of arcs) x[a][b] = columns[varName(a, b)]?.Primal ?? 0;
    return x;
  };

  const remainingSeconds = () => Math.max(0.1, (deadline - now()) / 1000);
  const report = (phase: BranchAndCutProgress['phase'], lowerBound: number) =>
    options.onProgress?.({ phase, lowerBound, upperBound: bestCost, cuts: cuts.length });

  /** Exact separation: min source -> v cut for every v, on the fractional support graph. */
  const separate = (x: number[][]): number => {
    let added = 0;
    for (let target = 0; target < size && added < 50; target += 1) {
      if (target === source) continue;
      const reachable = minCutSourceSide(x, size, source, target);
      if (reachable) {
        if (addCut(reachable)) added += 1;
      }
    }
    return added;
  };

  // 1. Root cutting-plane loop on the LP relaxation.
  let lowerBound = 0;
  for (let round = 0; round < 200 && now() < deadline; round += 1) {
    const lp = highs.solve(buildModel(false), { time_limit: remainingSeconds(), output_flag: false });
    if (lp.Status !== 'Optimal') break;
    lowerBound = Math.max(lowerBound, lp.ObjectiveValue);
    report('root', lowerBound);
    if (lowerBound >= bestCost - EPS) {
      return { path: bestPath, cost: bestCost, lowerBound: bestCost, provenOptimal: true, cuts: cuts.length, mipRounds: 0 };
    }
    if (separate(readSolution(lp.Columns)) === 0) break;
  }

  // 2. MIP loop with lazy connectivity cuts on integer solutions.
  let mipRounds = 0;
  while (now() < deadline) {
    mipRounds += 1;
    const mip = highs.solve(buildModel(true), {
      time_limit: remainingSeconds(),
      mip_rel_gap: 0,
      mip_abs_gap: EPS,
      objective_bound: bestCost - EPS,
      output_flag: false,
    });

    if (mip.Status === 'Infeasible') {
      // Nothing strictly better than the incumbent exists.
      return { path: bestPath, cost: bestCost, lowerBound: bestCost, provenOptimal: true, cuts: cuts.length, mipRounds };
    }
    if (mip.Status !== 'Optimal') break; // time limit or solver issue: keep the incumbent

    lowerBound = Math.max(lowerBound, mip.ObjectiveValue);
    report('mip', lowerBound);
    const x = readSolution(mip.Columns);
    const successor = new Array<number>(size).fill(-1);
    for (const [a, b] of arcs) if (x[a][b] > 0.5) successor[a] = b;

    const visited = new Array<boolean>(size).fill(false);
    const path = [source];
    visited[source] = true;
    let current = source;
    while (current !== sink && successor[current] !== -1 && !visited[successor[current]]) {
      current = successor[current];
      visited[current] = true;
      path.push(current);
    }

    if (path.length === size && current === sink) {
      const candidateCost = pathCost(path, cost);
      if (candidateCost < bestCost) {
        bestPath = path;
        bestCost = candidateCost;
      }
      return { path: bestPath, cost: bestCost, lowerBound: bestCost, provenOptimal: true, cuts: cuts.length, mipRounds };
    }

    // The integer solution is the source -> sink path plus disjoint cycles: cut them off.
    let added = addCut(visited) ? 1 : 0;
    for (let start = 0; start < size; start += 1) {
      if (visited[start]) continue;
      const cycle = new Array<boolean>(size).fill(false);
      let node = start;
      while (node !== -1 && !cycle[node]) {
        cycle[node] = true;
        node = successor[node];
      }
      // Complement of a cycle contains the source: x(δ+(V \ C)) ≥ 1.
      const complement = cycle.map((inCycle) => !inCycle);
      if (addCut(complement)) added += 1;
      cycle.forEach((inCycle, index) => {
        if (inCycle) visited[index] = true;
      });
    }
    if (added === 0) break;
  }

  return { path: bestPath, cost: bestCost, lowerBound: Math.min(lowerBound, bestCost), provenOptimal: false, cuts: cuts.length, mipRounds };
};

/**
 * Max-flow (Edmonds-Karp) from `source` to `target` with capacities x. Returns the source side
 * of a minimum cut if the max flow is < 1 (a violated connectivity cut), otherwise undefined.
 */
const minCutSourceSide = (x: number[][], size: number, source: number, target: number): boolean[] | undefined => {
  const residual = x.map((row) => row.slice());
  let flow = 0;
  const parent = new Array<number>(size);
  const queue = new Array<number>(size);
  for (;;) {
    parent.fill(-1);
    parent[source] = source;
    let head = 0;
    let tail = 0;
    queue[tail++] = source;
    while (head < tail && parent[target] === -1) {
      const u = queue[head++];
      const row = residual[u];
      for (let v = 0; v < size; v += 1) {
        if (parent[v] === -1 && row[v] > EPS) {
          parent[v] = u;
          queue[tail++] = v;
        }
      }
    }
    if (parent[target] === -1) {
      if (flow >= 1 - 1e-4) return undefined;
      return parent.map((p) => p !== -1);
    }
    let bottleneck = Number.POSITIVE_INFINITY;
    for (let v = target; v !== source; v = parent[v]) bottleneck = Math.min(bottleneck, residual[parent[v]][v]);
    for (let v = target; v !== source; v = parent[v]) {
      residual[parent[v]][v] -= bottleneck;
      residual[v][parent[v]] += bottleneck;
    }
    flow += bottleneck;
    if (flow >= 1 - 1e-4) return undefined;
  }
};
