/**
 * Transaction state machine.
 *
 * States:
 *   draft       — created, editable
 *   submitted   — awaiting approval
 *   approved    — passed approval (ready to post)
 *   rejected    — bounced back, can return to draft
 *   posted      — committed, journal generated, IRREVERSIBLE
 *
 * Allowed transitions:
 *   draft     → submitted
 *   submitted → approved | rejected | draft  (recall)
 *   approved  → posted
 *   rejected  → draft
 *   posted    → (terminal — no further transitions)
 */
import type { TransactionStatus } from '../types.js';

const TRANSITIONS: Record<TransactionStatus, ReadonlyArray<TransactionStatus>> = {
  draft: ['submitted'],
  submitted: ['approved', 'rejected', 'draft'],
  approved: ['posted'],
  rejected: ['draft'],
  posted: [],
} as const;

export function canTransition(from: TransactionStatus, to: TransactionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextAllowed(from: TransactionStatus): ReadonlyArray<TransactionStatus> {
  return TRANSITIONS[from];
}

export class IllegalTransitionError extends Error {
  constructor(public from: TransactionStatus, public to: TransactionStatus) {
    super(`Illegal transition: ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}
