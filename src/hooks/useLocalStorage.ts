import { useEffect, useRef, useState } from 'react';

const isBrowser = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export const useLocalStorage = <T,>(key: string, defaultValue: T): [T, (value: T) => void] => {
  const initialised = useRef(false);
  const [value, setValue] = useState<T>(() => {
    if (!isBrowser) {
      return defaultValue;
    }
    try {
      const stored = window.localStorage.getItem(key);
      return stored ? (JSON.parse(stored) as T) : defaultValue;
    } catch (error) {
      console.warn('Failed to read from localStorage for key', key, error);
      return defaultValue;
    }
  });

  useEffect(() => {
    if (!isBrowser) {
      return;
    }
    if (!initialised.current) {
      initialised.current = true;
      return;
    }
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn('Failed to write to localStorage for key', key, error);
    }
  }, [key, value]);

  return [value, setValue];
};
