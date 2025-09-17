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

    const whitespaceParts = line
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    let label: string | undefined;
    let latToken: string | undefined;
    let lonToken: string | undefined;

    const tokenSets: string[][] = [];
    if (parts.length > 0) {
      tokenSets.push(parts);
    }
    if (whitespaceParts.length > 0 && whitespaceParts.join(' ') !== parts.join(' ')) {
      tokenSets.push(whitespaceParts);
    }

    const tryLatLonFirst = (tokens: string[]): boolean => {
      if (tokens.length < 2) {
        return false;
      }
      const potentialLat = tokens[0];
      const potentialLon = tokens[1];
      const latitude = Number(potentialLat.replace(',', '.'));
      const longitude = Number(potentialLon.replace(',', '.'));

      if (!isValidNumber(latitude) || !isValidNumber(longitude)) {
        return false;
      }

      latToken = potentialLat;
      lonToken = potentialLon;
      const labelTokens = tokens.slice(2).filter((token) => token.length > 0);
      label = labelTokens.length > 0 ? labelTokens.join(' ') : undefined;
      return true;
    };

    const tryLabelFirst = (tokens: string[]): boolean => {
      if (tokens.length < 3) {
        return false;
      }
      label = tokens[0];
      latToken = tokens[1];
      lonToken = tokens[2];
      return true;
    };

    for (const tokens of tokenSets) {
      if (!latToken || !lonToken) {
        if (tryLatLonFirst(tokens)) {
          break;
        }
      }
    }

    if (!latToken || !lonToken) {
      for (const tokens of tokenSets) {
        if (tryLabelFirst(tokens)) {
          break;
        }
      }
    }

    if (!latToken || !lonToken) {
      if (parts.length === 2) {
        latToken = parts[0];
        lonToken = parts[1];
      } else if (whitespaceParts.length === 2) {
        latToken = whitespaceParts[0];
        lonToken = whitespaceParts[1];
      }
    }

    if (!latToken || !lonToken) {
      errors.push('Line ' + (lineIndex + 1) + ': expected format "latitude, longitude[, label]" or "label, latitude, longitude" (received "' + line + '")');
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

    const cleanLabel = label && label.length > 0 ? label : 'Point ' + autoIndex;
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
