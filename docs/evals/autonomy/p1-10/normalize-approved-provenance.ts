/** Format-only reception correction required by the real I13 source parser. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {evaluation,repository,put,hash} from './prepare-pilots';
import {loadWorkflowState} from '../../../../core/tools/aidlc-light-state';
const key=process.argv[2]||'publish-r7',dir=join(evaluation,key),root=JSON.parse(readFileSync(join(dir,'preparation.json'),'utf8')).root;
const path='docs/aidlc/modules/project/inception/application-design.md';
const original=readFileSync(join(evaluation,'publish-r6/application-review-package/source',path),'utf8');
const corrected=readFileSync(join(repository,'.worktrees/aidlc-p1-10-publish-r6',path),'utf8');
assert.equal(corrected,original.replace('# Application design review — REQ-001 / PAGE-001','# Application design review\n\nSources: REQ-001 / PAGE-001; STORY-001 / US-001. These are provenance references to existing definitions, not new requirement definitions.'));
assert.equal(readFileSync(join(root,path),'utf8'),original);
const state=loadWorkflowState(root)!;assert.equal(Object.keys(state.active_instances).length,0);assert.equal(state.autonomy_contract_version,undefined);assert.equal(state.execution_grant_version,undefined);
put(dir,'provenance-format-correction.json',{kind:'source-reference-format-only',original_approval:'publish-r6/application-approval-input.json',original_sha256:hash(original),normalized_sha256:hash(corrected),path,replacement:{before:original.split('\n')[0],after:corrected.split('\n').slice(0,3).join('\n')},business_sections_unchanged:true,requirement_definitions_added:false,acceptance_denominator_changed:false,original_review_snapshot_retained:true,reason:'The actual I13 parser rejects an incidental REQ/PAGE reference in a non-defining title and explicitly requires a Sources: field. This copies the already existing source annotation; no product, interface, UI, unit or deployment decision changes.',grant_issued:false,business_verified:false});
writeFileSync(join(root,path),corrected);
console.log(JSON.stringify({key,source_reference_format_corrected:true,product_design_unchanged:true,grant_issued:false}));
