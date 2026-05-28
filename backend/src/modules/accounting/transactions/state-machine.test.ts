/**
 * State machine unit tests.
 */
import { describe, expect, it } from 'vitest';
import {
  IllegalTransitionError,
  canTransition,
  nextAllowed,
} from './state-machine.js';

describe('transaction state machine', () => {
  it('allows the happy path', () => {
    expect(canTransition('draft', 'submitted')).toBe(true);
    expect(canTransition('submitted', 'approved')).toBe(true);
    expect(canTransition('approved', 'posted')).toBe(true);
  });

  it('allows rejection and recall', () => {
    expect(canTransition('submitted', 'rejected')).toBe(true);
    expect(canTransition('rejected', 'draft')).toBe(true);
    expect(canTransition('submitted', 'draft')).toBe(true); // recall
  });

  it('rejects illegal transitions', () => {
    expect(canTransition('draft', 'approved')).toBe(false);
    expect(canTransition('draft', 'posted')).toBe(false);
    expect(canTransition('submitted', 'posted')).toBe(false);
  });

  it('posted is terminal', () => {
    expect(nextAllowed('posted')).toHaveLength(0);
    expect(canTransition('posted', 'draft')).toBe(false);
    expect(canTransition('posted', 'submitted')).toBe(false);
    expect(canTransition('posted', 'approved')).toBe(false);
    expect(canTransition('posted', 'posted')).toBe(false);
  });

  it('exposes nextAllowed for UI hints', () => {
    expect(nextAllowed('draft')).toEqual(['submitted']);
    expect(nextAllowed('submitted')).toEqual(['approved', 'rejected', 'draft']);
  });

  it('IllegalTransitionError carries from/to fields', () => {
    const e = new IllegalTransitionError('posted', 'draft');
    expect(e.from).toBe('posted');
    expect(e.to).toBe('draft');
    expect(e.message).toContain('posted');
    expect(e.message).toContain('draft');
  });
});
