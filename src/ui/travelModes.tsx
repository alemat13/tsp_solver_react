import { Bike, Car, Footprints, LucideIcon, Mountain, TramFront, Truck, Zap } from 'lucide-react';
import { TravelMode } from '../types';

export interface TravelModeOption {
  value: TravelMode;
  label: string;
  icon: LucideIcon;
  /** Which API key the mode relies on for real road data. */
  provider: 'ors' | 'google';
}

export const TRAVEL_MODES: TravelModeOption[] = [
  { value: 'driving-car', label: 'Voiture', icon: Car, provider: 'ors' },
  { value: 'cycling-regular', label: 'Vélo', icon: Bike, provider: 'ors' },
  { value: 'cycling-electric', label: 'VAE', icon: Zap, provider: 'ors' },
  { value: 'foot-walking', label: 'À pied', icon: Footprints, provider: 'ors' },
  { value: 'foot-hiking', label: 'Rando', icon: Mountain, provider: 'ors' },
  { value: 'driving-hgv', label: 'Poids lourd', icon: Truck, provider: 'ors' },
  { value: 'transit', label: 'Transports', icon: TramFront, provider: 'google' },
];

export const travelModeOption = (mode: TravelMode) => TRAVEL_MODES.find((option) => option.value === mode) || TRAVEL_MODES[0];
