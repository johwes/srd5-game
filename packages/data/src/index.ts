/**
 * Statutory Creative Commons Attribution 4.0 International (CC-BY-4.0) notice
 * required by the System Reference Document 5.1 (SRD 5.1).
 */
export const SRD_LEGAL_ATTRIBUTION =
  'This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.' as const;

export const SRD_VERSION = '5.1' as const;
export const SRD_LICENSE = 'CC-BY-4.0' as const;

export * from './schemas/index.js';
export * from './ingestion/index.js';
export * from './overlays/index.js';
