import { CoordinatePoint } from '../types';

const LAT_RANGE: [number, number] = [-90, 90];
const LON_RANGE: [number, number] = [-180, 180];

export interface ParseResult {
  points: CoordinatePoint[];
  errors: string[];
  warnings: string[];
}

const sanitizeId = (label: string, fallbackIndex: number): string => {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? slug + '-' + fallbackIndex : 'point-' + fallbackIndex;
};

const isValidNumber = (value: number) => Number.isFinite(value);

const withinRange = (value: number, range: [number, number]) => value >= range[0] && value <= range[1];

export const parseCoordinateLines = (input: string): ParseResult => {
  const points: CoordinatePoint[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  const lines = input.split(/\r?\n/);
  let autoIndex = 1;

  lines.forEach((rawLine, lineIndex) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      return;
    }

    const parts = line
      .split(/[;,\t]/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    let label: string | undefined;
    let latToken: string | undefined;
    let lonToken: string | undefined;

    if (parts.length >= 3) {
      label = parts[0];
      latToken = parts[1];
      lonToken = parts[2];
    } else if (parts.length === 2) {
      latToken = parts[0];
      lonToken = parts[1];
      label = 'Point ' + autoIndex;
    } else {
      const whitespaceParts = line
        .split(/\s+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);

      if (whitespaceParts.length >= 3) {
        label = whitespaceParts[0];
        latToken = whitespaceParts[1];
        lonToken = whitespaceParts[2];
      } else if (whitespaceParts.length === 2) {
        latToken = whitespaceParts[0];
        lonToken = whitespaceParts[1];
        label = 'Point ' + autoIndex;
      }
    }

    if (!latToken || !lonToken) {
      errors.push('Line ' + (lineIndex + 1) + ': expected format "label, lat, lon" (received "' + line + '")');
      return;
    }

    const latitude = Number(latToken.replace(',', '.'));
    const longitude = Number(lonToken.replace(',', '.'));

    if (!isValidNumber(latitude) || !withinRange(latitude, LAT_RANGE)) {
      errors.push('Line ' + (lineIndex + 1) + ': latitude "' + latToken + '" is invalid or out of range');
      return;
    }

    if (!isValidNumber(longitude) || !withinRange(longitude, LON_RANGE)) {
      errors.push('Line ' + (lineIndex + 1) + ': longitude "' + lonToken + '" is invalid or out of range');
      return;
    }

    const cleanLabel = label || 'Point ' + autoIndex;
    const id = sanitizeId(cleanLabel, autoIndex);

    const duplicates = points.filter((point) => point.id === id).length;
    const dedupedId = duplicates ? id + '-' + (duplicates + 1) : id;

    if (duplicates) {
      warnings.push('Duplicate label detected at line ' + (lineIndex + 1) + '; id adjusted to ' + dedupedId + '.');
    }

    points.push({
      id: dedupedId,
      label: cleanLabel,
      latitude,
      longitude,
    });

    autoIndex += 1;
  });

  return { points, errors, warnings };
};
