/** Core-owned mutable input domains. These digests never authorize execution or renew evidence. */
import {execFileSync} from 'node:child_process';
import {readSourceRevision} from './aidlc-revision';
import {autonomyDigest} from './aidlc-autonomy-files';

export const DECISION_PROPOSAL_ROOT = '.aidlc/proposals/decisions';
export function classifyExecutionChange(path: string): 'control-output'|'decision-metadata'|'documentation'|'business-source' {
  if (/^(?:\.aidlc|aidlc)(?:\/|$)/.test(path) || ['.gitignore','.gitattributes'].includes(path)) return 'control-output';
  if (path === 'docs/aidlc/handoff.md') return 'decision-metadata';
  return /\.(?:md|txt|rst)$/i.test(path) ? 'documentation' : 'business-source';
}
export function assertProposalIsolation(root: string): void {
  const tracked=execFileSync('git',['ls-files','-z','--',DECISION_PROPOSAL_ROOT],{cwd:root,encoding:'utf8',windowsHide:true,timeout:10000});
  if(tracked) throw Error('CANDIDATE_PROPOSAL_TRACKED: delegated proposals must remain outside the delivery candidate');
}
export function executionInputIdentity(root: string, environment: unknown) {
  // Ordinary documentation remains a real command input. Only the canonical decision
  // publication is excluded; its frozen policy records remain protected by grant checks.
  // A commit with unchanged input bytes cannot reset an equivalent command's retries.
  const revision=readSourceRevision(root,{label:'autonomous-command-inputs/v1',exclude:p=>classifyExecutionChange(p)==='decision-metadata'});
  const environmentDigest=environment===null?null:autonomyDigest(environment);
  const commandDigest=revision.scope_digest&&environmentDigest?autonomyDigest([revision.scope_digest,environmentDigest]):null;
  return {
    schema:'aidlc.execution-input-identity/v1',
    source_digest:revision.worktree_digest,
    command_source_digest:revision.scope_digest,
    environment_digest:environmentDigest,
    command_digest:commandDigest,
    candidate_input_digest:revision.worktree_digest?autonomyDigest([revision.commit,revision.worktree_digest]):null,
    change_policy:{'business-source':'invalidate-command-and-candidate',documentation:'invalidate-command-and-candidate','decision-metadata':'invalidate-candidate-and-final-observation','control-output':'no-source-invalidation',environment:'invalidate-command-and-observation'},
  };
}
