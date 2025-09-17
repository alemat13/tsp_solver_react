const TIME_PER_PERMUTATION_SECONDS = 0.0005; // 0.5 ms per permutation baseline.
const PERMUTATION_CAP = 1e9; // beyond this, treat duration as effectively unbounded.

const computeFactorialWithCap = (n: number): number => {
  if (n <= 1) {
    return 1;
  }
  let result = 1;
  for (let i = 2; i <= n; i += 1) {
    result *= i;
    if (result > PERMUTATION_CAP) {
      return Number.POSITIVE_INFINITY;
    }
  }
  return result;
};

export const estimateBruteForceSeconds = (pointCount: number): number => {
  if (pointCount <= 2) {
    return 0.05;
  }

  const permutations = computeFactorialWithCap(Math.max(pointCount - 1, 1));
  if (!Number.isFinite(permutations)) {
    return Number.POSITIVE_INFINITY;
  }

  return permutations * TIME_PER_PERMUTATION_SECONDS;
};

const pluralise = (value: number, singular: string, plural: string) => {
  return value === 1 ? singular : plural;
};

export const formatDurationEstimate = (seconds: number): string => {
  if (!Number.isFinite(seconds)) {
    return '> several days';
  }

  if (seconds < 1) {
    return '< 1 second';
  }
  if (seconds < 60) {
    const rounded = Math.max(1, Math.round(seconds));
    return '~' + rounded + ' ' + pluralise(rounded, 'second', 'seconds');
  }
  const minutes = seconds / 60;
  if (minutes < 60) {
    const rounded = Math.max(1, Math.round(minutes));
    return '~' + rounded + ' ' + pluralise(rounded, 'minute', 'minutes');
  }
  const hours = minutes / 60;
  if (hours < 24) {
    const rounded = Math.max(1, Math.round(hours));
    return '~' + rounded + ' ' + pluralise(rounded, 'hour', 'hours');
  }
  const days = hours / 24;
  const rounded = Math.max(1, Math.round(days));
  return '~' + rounded + ' ' + pluralise(rounded, 'day', 'days');
};

export const describeBruteForceEstimate = (pointCount: number): string => {
  const seconds = estimateBruteForceSeconds(pointCount);
  return formatDurationEstimate(seconds);
};
