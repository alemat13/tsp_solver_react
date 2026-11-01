import { vi } from 'vitest';
import { searchPlaces } from '../geocoding';

globalThis.fetch = vi.fn();
const mockFetch = () => globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

describe('geocoding cache', () => {
  beforeEach(() => {
    mockFetch().mockReset();
    mockFetch().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [{ geometry: { coordinates: [2.35, 48.85] }, properties: { name: 'Paris' } }] }),
    });
  });

  it('answers a repeated search from the cache', async () => {
    const first = await searchPlaces('Paris ', 'k');
    const second = await searchPlaces('  paris', 'k');
    expect(mockFetch()).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });
});
