
import { parseCoordinateLines } from '../coordinateParser';

describe('parseCoordinateLines', () => {
  it('should parse a valid coordinate string', () => {
    const input = '40.7128, -74.0060';
    const result = parseCoordinateLines(input);
    expect(result.points).toEqual([{ id: 'point-1-1', label: 'Point 1', latitude: 40.7128, longitude: -74.0060 }]);
  });

  it('should parse multiple valid coordinate strings', () => {
    const input = '40.7128, -74.0060\n48.8566, 2.3522';
    const result = parseCoordinateLines(input);
    expect(result.points).toEqual([
      { id: 'point-1-1', label: 'Point 1', latitude: 40.7128, longitude: -74.0060 },
      { id: 'point-2-2', label: 'Point 2', latitude: 48.8566, longitude: 2.3522 },
    ]);
  });

  it('should ignore empty lines', () => {
    const input = '40.7128, -74.0060\n\n48.8566, 2.3522';
    const result = parseCoordinateLines(input);
    expect(result.points).toEqual([
      { id: 'point-1-1', label: 'Point 1', latitude: 40.7128, longitude: -74.0060 },
      { id: 'point-2-2', label: 'Point 2', latitude: 48.8566, longitude: 2.3522 },
    ]);
  });

  it('should return an error for invalid coordinate strings', () => {
    const input = '40.7128, -74.0060\ninvalid\n48.8566, 2.3522';
    const result = parseCoordinateLines(input);
    expect(result.errors).toEqual(['Line 2: expected format "latitude, longitude[, label]" or "label, latitude, longitude" (received "invalid")']);
  });

  it('should handle different delimiters', () => {
    const input = '40.7128 -74.0060;48.8566 2.3522';
    const result = parseCoordinateLines(input);
    expect(result.points).toEqual([
        { id: 'point-1-1', label: 'Point 1', latitude: 40.7128, longitude: -74.0060 },
        { id: 'point-2-2', label: 'Point 2', latitude: 48.8566, longitude: 2.3522 },
    ]);
  });
});
