import { render, screen } from '@testing-library/react';
import { TransitSteps } from '../TransitSteps';
import { TransitLeg } from '../../types';

const leg: TransitLeg = {
  duration: 1500,
  distance: 5200,
  steps: [
    { kind: 'walk', duration: 180, distance: 200 },
    {
      kind: 'transit',
      duration: 900,
      ride: {
        line: '6',
        vehicleType: 'SUBWAY',
        vehicleName: 'Subway',
        headsign: 'Nation',
        departureStop: 'Bir-Hakeim',
        arrivalStop: 'Palais Royal',
        departureText: '13:05',
        arrivalText: '13:20',
        stopCount: 9,
        agency: 'RATP',
        agencyUrl: 'https://www.ratp.fr/',
      },
    },
  ],
};

test('shows lines, stops, times and walking parts', () => {
  render(<TransitSteps leg={leg} />);
  expect(screen.getByText('13:05 – 13:20')).toBeInTheDocument();
  expect(screen.getByText('towards Nation')).toBeInTheDocument();
  expect(screen.getByText('Bir-Hakeim')).toBeInTheDocument();
  expect(screen.getByText('Palais Royal')).toBeInTheDocument();
  expect(screen.getByText(/9 stops · 15 min/)).toBeInTheDocument();
  expect(screen.getByText(/Walk 3 min · 200 m/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'RATP' })).toHaveAttribute('href', 'https://www.ratp.fr/');
});
