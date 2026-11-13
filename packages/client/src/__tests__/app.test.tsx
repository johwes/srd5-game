import { SRD_LEGAL_ATTRIBUTION } from '@srd5/data';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../App.js';

describe('@srd5/client App shell', () => {
  it('renders application title and CC-BY-4.0 legal attribution footer', () => {
    render(<App />);
    expect(screen.getByText(/SRD 5.1 Tactical Dungeon Crawler/i)).toBeDefined();
    expect(screen.getByText(SRD_LEGAL_ATTRIBUTION)).toBeDefined();
  });
});
