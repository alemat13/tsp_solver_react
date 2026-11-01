import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';
import { clearApiCache } from '../services/apiCache';

// API responses are cached across calls: start every test with an empty cache.
beforeEach(async () => {
  await clearApiCache();
});
