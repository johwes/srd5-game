/**
 * SRD-1104 — Diplomacy, sub-faction patronage & enemy-territory patrols.
 *
 * Compatibility barrel: the implementation now lives in focused modules
 * (`war-threat`, `war-contracts`, `war-subfactions`, `war-patrols`, plus
 * shared `war-negotiation-utils`). Import the focused module directly in new
 * code; this barrel keeps existing `@srd5/engine` consumers working.
 */
export * from './war-threat.js';
export * from './war-negotiation-utils.js';
export * from './war-contracts.js';
export * from './war-subfactions.js';
export * from './war-patrols.js';
