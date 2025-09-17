import { ChangeEvent } from 'react';

export interface CoordinateInputProps {
  value: string;
  onChange: (value: string) => void;
  onParse: () => void;
  disabled?: boolean;
}

export const CoordinateInput = ({ value, onChange, onParse, disabled }: CoordinateInputProps) => {
  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(event.target.value);
  };

  return (
    <section className="panel">
      <header className="panel__header">
        <div>
          <h2 className="panel__title">Locations</h2>
          <p className="panel__subtitle">
            Paste one entry per line using "label, latitude, longitude". Lines starting with # are ignored.
          </p>
        </div>
        <button type="button" className="primary" onClick={onParse} disabled={disabled}>
          Parse &amp; Solve
        </button>
      </header>
      <textarea
        className="coordinate-input"
        value={value}
        onChange={handleChange}
        placeholder="Eiffel Tower, 48.85837, 2.29448"
        rows={12}
      />
    </section>
  );
};
