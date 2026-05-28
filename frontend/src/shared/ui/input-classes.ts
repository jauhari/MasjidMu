/**
 * Shared input class strings.
 *
 * Avoids duplicating Tailwind tokens across every form. Compose with `class=`.
 */
export const INPUT_BASE =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-500';

export const TEXTAREA_BASE = `${INPUT_BASE} min-h-[80px]`;

export const LABEL_BASE = 'block text-sm font-medium text-slate-700';
