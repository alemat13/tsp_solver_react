import { SolveRequest, SolveResult } from "../types";

import { computeTotals, deriveResult, Totals } from "./common";

const NUMBER_EPSILON = Number.EPSILON || 2.220446049250313e-16;

const generateInitialPopulation = (
  size: number,
  populationSize: number,
  fixedStart?: number,
  fixedEnd?: number,
): number[][] => {
  const population: number[][] = [];

  if (fixedStart !== undefined) {
    const baseIndices = Array.from({ length: size }, (_, i) => i).filter(
      (i) => i !== fixedStart && i !== fixedEnd,
    );

    for (let i = 0; i < populationSize; i += 1) {
      const perm = baseIndices.slice();

      for (let j = perm.length - 1; j > 0; j -= 1) {
        const k = Math.floor(Math.random() * (j + 1));

        [perm[j], perm[k]] = [perm[k], perm[j]];
      }

      const route = [fixedStart, ...perm];

      if (fixedEnd !== undefined) {
        route.push(fixedEnd);
      }

      population.push(route);
    }
  } else {
    const indices = Array.from({ length: size }, (_, i) => i);

    for (let i = 0; i < populationSize; i += 1) {
      const perm = indices.slice();

      for (let j = perm.length - 1; j > 0; j -= 1) {
        const k = Math.floor(Math.random() * (j + 1));

        [perm[j], perm[k]] = [perm[k], perm[j]];
      }

      population.push(perm);
    }
  }

  return population;
};

const tournamentSelection = (
  population: number[][],
  distances: number[][],
  k: number,
): number[] => {
  const candidates: number[][] = [];

  for (let i = 0; i < k; i += 1) {
    const idx = Math.floor(Math.random() * population.length);

    candidates.push(population[idx]);
  }

  let best: number[] | undefined;

  let bestFitness = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const totals = computeTotals(candidate, distances);

    if (totals.totalDistance < bestFitness - NUMBER_EPSILON) {
      bestFitness = totals.totalDistance;

      best = candidate;
    }
  }

  return best ? best.slice() : population[0].slice();
};

const orderCrossover = (parent1: number[], parent2: number[]): number[] => {
  const size = parent1.length;

  const child = new Array(size).fill(-1);

  const start = Math.floor(Math.random() * size);

  const end = Math.floor(Math.random() * size);

  let left = Math.min(start, end);

  let right = Math.max(start, end);

  for (let i = left; i <= right; i += 1) {
    child[i] = parent1[i];
  }

  const remaining: number[] = [];

  for (let i = 0; i < size; i += 1) {
    if (!parent2.includes(parent1[i]) || i < left || i > right) {
      remaining.push(parent2[i]);
    }
  }

  let remIdx = 0;

  for (let i = 0; i < size; i += 1) {
    if (child[i] === -1) {
      child[i] = remaining[remIdx];

      remIdx += 1;
    }
  }

  return child;
};

const reverseSequenceMutation = (route: number[]): number[] => {
  const mutated = route.slice();

  const size = mutated.length;

  if (size < 3) {
    return mutated;
  }

  const i = Math.floor(Math.random() * (size - 2));

  const k = Math.floor(Math.random() * (size - i - 2)) + i + 1;

  const reversed = mutated.slice(i, k + 1).reverse();

  for (let j = i; j <= k; j += 1) {
    mutated[j] = reversed[j - i];
  }

  return mutated;
};

const twoOptSwap = (route: number[], i: number, k: number): number[] => {
  const start = route.slice(0, i);

  const middle = route.slice(i, k + 1).reverse();

  const end = route.slice(k + 1);

  return start.concat(middle, end);
};

const refineWithTwoOpt = (
  route: number[],
  distances: number[][],
  lockedStart?: boolean,
  lockedEnd?: boolean,
): number[] => {
  let improved = route.slice();

  let improvedAny = true;

  while (improvedAny) {
    improvedAny = false;

    for (let i = 1; i < improved.length - 2; i += 1) {
      if (lockedStart && i === 1) {
        continue;
      }

      for (let k = i + 1; k < improved.length - 1; k += 1) {
        if (lockedEnd && k + 1 >= improved.length - 1) {
          continue;
        }

        const a = improved[i - 1];

        const b = improved[i];

        const c = improved[k];

        const d = improved[k + 1];

        const currentDistance = distances[a][b] + distances[c][d];

        const swappedDistance = distances[a][c] + distances[b][d];

        if (swappedDistance < currentDistance - 1e-6) {
          improved = twoOptSwap(improved, i, k);

          improvedAny = true;
        }
      }
    }
  }

  return improved;
};

const evaluatePopulation = (
  population: number[][],
  distances: number[][],
): number[] => {
  return population.map((route) => {
    const totals = computeTotals(route, distances);

    return totals.totalDistance;
  });
};

export const solveGenetic = (request: SolveRequest): SolveResult => {
  const { points, matrix, startId, endId } = request;

  const size = points.length;

  if (size < 2) {
    return {
      orderedPoints: points,

      orderedIds: points.map((point) => point.id),

      totalDistance: 0,

      totalDuration: 0,

      strategy: "genetic",

      warnings: ["Provide at least two locations to optimise an itinerary."],
    };
  }

  const idToIndex = new Map<string, number>();

  points.forEach((point, index) => {
    idToIndex.set(point.id, index);
  });

  const fixedStart = startId ? idToIndex.get(startId) : undefined;

  const fixedEnd = endId ? idToIndex.get(endId) : undefined;

  const warnings: string[] = [];

  if (
    typeof fixedStart === "number" &&
    typeof fixedEnd === "number" &&
    fixedStart === fixedEnd &&
    size > 1
  ) {
    warnings.push(
      "Start and end points are identical; treating itinerary as a loop.",
    );
  }

  const lockedStart = typeof fixedStart === "number";

  const lockedEnd = typeof fixedEnd === "number";

  if (size === 2) {
    const start = typeof fixedStart === "number" ? fixedStart : 0;

    const end = typeof fixedEnd === "number" ? fixedEnd : 1;

    const route =
      lockedStart && lockedEnd
        ? [start, end]
        : lockedStart
          ? [start, start === 0 ? 1 : 0]
          : [start, start === 0 ? 1 : 0];

    const totals = computeTotals(route, matrix.distances, matrix.durations);

    return deriveResult(points, route, totals, "genetic", warnings);
  }

  const maxGenerations = 500;

  const populationSize = 100;

  const tournamentSize = 3;

  const mutationRate = 0.15;

  const elitismCount = 1;

  let population = generateInitialPopulation(
    size,
    populationSize,
    fixedStart,
    fixedEnd,
  );

  if (lockedStart || lockedEnd) {
    population = population.map((route) => {
      if (lockedStart && route[0] !== fixedStart) {
        const idx = route.indexOf(fixedStart);

        if (idx !== -1) {
          [route[0], route[idx]] = [route[idx], route[0]];
        }
      }

      if (lockedEnd && route[route.length - 1] !== fixedEnd) {
        const idx = route.indexOf(fixedEnd);

        if (idx !== -1) {
          [route[route.length - 1], route[idx]] = [
            route[idx],
            route[route.length - 1],
          ];
        }
      }

      return route;
    });
  }

  let bestRoute: number[] | undefined;

  let bestScore = Number.POSITIVE_INFINITY;

  let bestTotals: Totals = {
    totalDistance: Number.POSITIVE_INFINITY,
    totalDuration: undefined,
  };

  for (let generation = 0; generation < maxGenerations; generation += 1) {
    const fitnesses = evaluatePopulation(population, matrix.distances);

    for (let i = 0; i < population.length; i += 1) {
      const route = population[i];

      const totals = computeTotals(route, matrix.distances, matrix.durations);

      if (totals.totalDistance < bestScore - NUMBER_EPSILON) {
        bestScore = totals.totalDistance;

        bestRoute = route.slice();

        bestTotals = totals;
      }
    }

    if (generation === maxGenerations - 1) {
      break;
    }

    const newPopulation: number[][] = [];

    const sortedIndices = population

      .map((_, i) => i)

      .sort((a, b) => fitnesses[a] - fitnesses[b]);

    for (let i = 0; i < elitismCount; i += 1) {
      if (sortedIndices[i] < population.length) {
        newPopulation.push(population[sortedIndices[i]].slice());
      }
    }

    while (newPopulation.length < populationSize) {
      const parent1 = tournamentSelection(
        population,
        matrix.distances,
        tournamentSize,
      );

      const parent2 = tournamentSelection(
        population,
        matrix.distances,
        tournamentSize,
      );

      const child = orderCrossover(parent1, parent2);

      if (Math.random() < mutationRate) {
        const mutated = reverseSequenceMutation(child);

        newPopulation.push(mutated);
      } else {
        newPopulation.push(child);
      }
    }

    population = newPopulation;

    if (lockedStart || lockedEnd) {
      population = population.map((route) => {
        if (lockedStart && route[0] !== fixedStart) {
          const idx = route.indexOf(fixedStart);

          if (idx !== -1) {
            [route[0], route[idx]] = [route[idx], route[0]];
          }
        }

        if (lockedEnd && route[route.length - 1] !== fixedEnd) {
          const idx = route.indexOf(fixedEnd);

          if (idx !== -1) {
            [route[route.length - 1], route[idx]] = [
              route[idx],
              route[route.length - 1],
            ];
          }
        }

        return route;
      });
    }
  }

  if (bestRoute && bestScore < Number.POSITIVE_INFINITY - NUMBER_EPSILON) {
    const finalRoute = refineWithTwoOpt(
      bestRoute,
      matrix.distances,
      lockedStart,
      lockedEnd,
    );

    const totals = computeTotals(
      finalRoute,
      matrix.distances,
      matrix.durations,
    );

    return deriveResult(points, finalRoute, totals, "genetic", warnings);
  }

  const fallbackRoute = Array.from({ length: size }, (_, i) => i);

  if (lockedStart) {
    const idx = fallbackRoute.indexOf(fixedStart);

    if (idx !== -1) {
      [fallbackRoute[0], fallbackRoute[idx]] = [
        fallbackRoute[idx],
        fallbackRoute[0],
      ];
    }
  }

  if (lockedEnd) {
    const idx = fallbackRoute.indexOf(fixedEnd);

    if (idx !== -1) {
      [fallbackRoute[fallbackRoute.length - 1], fallbackRoute[idx]] = [
        fallbackRoute[idx],
        fallbackRoute[fallbackRoute.length - 1],
      ];
    }
  }

  const totals = computeTotals(
    fallbackRoute,
    matrix.distances,
    matrix.durations,
  );

  return deriveResult(points, fallbackRoute, totals, "genetic", warnings);
};
