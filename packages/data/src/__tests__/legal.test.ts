import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRD_LEGAL_ATTRIBUTION, SRD_LICENSE, SRD_VERSION } from '../index.js';

describe('@srd5/data legal & attribution compliance', () => {
  it('exports the exact statutory WotC SRD 5.1 CC-BY-4.0 attribution notice', () => {
    expect(SRD_VERSION).toBe('5.1');
    expect(SRD_LICENSE).toBe('CC-BY-4.0');
    expect(SRD_LEGAL_ATTRIBUTION).toBe(
      'This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.',
    );
  });

  it('includes LEGAL.md at the repository root containing the exact statutory attribution', () => {
    const legalPath = resolve(import.meta.dirname, '../../../../LEGAL.md');
    const legalContent = readFileSync(legalPath, 'utf-8');
    expect(legalContent).toContain(SRD_LEGAL_ATTRIBUTION);
  });
});
