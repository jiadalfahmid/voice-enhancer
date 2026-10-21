import type { VersionStore } from './versions.ts';

export interface SecondPassCheck { allowed: boolean; reason?: string; warnings: string[] }

/** Plan section 4: second pass is explicit, never repeats a model silently, and always warns about distortion. */
export function checkSecondPass(store: VersionStore, parentId: string, engineId: string, opts: { userRequested: boolean }): SecondPassCheck {
  const parent = store.get(parentId);
  if (!opts.userRequested) return { allowed: false, reason: 'A second pass must be requested explicitly.', warnings: [] };
  if (!parent) return { allowed: false, reason: 'The selected result no longer exists.', warnings: [] };
  if (parent.status !== 'ok' || !parent.audio) return { allowed: false, reason: 'The selected result failed and cannot be processed again.', warnings: [] };
  const warnings = ['Further processing can add distortion instead of clarity. Compare it with the previous stage before keeping it.'];
  if (parent.kind === 'result' && parent.engineId === engineId) warnings.push('This is the same model that produced the selected result; repeating it rarely helps.');
  return { allowed: true, warnings };
}

/** What the comparison view must show for a result: its previous stage and the original, never just the original. */
export function comparisonTargets(store: VersionStore, id: string): string[] {
  const chain = store.lineage(id).filter((v) => v.status === 'ok');
  const ids = chain.map((v) => v.id);
  return ids.length <= 2 ? ids : [ids[0], ids[ids.length - 2], ids[ids.length - 1]];
}
