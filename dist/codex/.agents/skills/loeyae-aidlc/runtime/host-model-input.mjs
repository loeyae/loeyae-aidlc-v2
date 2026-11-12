// Model reading views only. Core receives and validates the original records.
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
export function modelRoute(route){
  if(!route||typeof route!=='object'||Array.isArray(route))return route;
  if(!route.kind&&!route.autonomous_admission&&!route.autonomy_scope&&!route.autonomy_decisions)return route;
  // Unknown extensions (including Provider and UI contracts) stay visible.
  const out={...route,model_view:'task-v1',full_view:'core(args, detail="full") preserves the original response; use next --preview for a read-only route.'};
  delete out.handoff_prompt;delete out.next_stage_prompt;
  if(route.autonomous_admission){const a=route.autonomous_admission;out.autonomous_admission={...pick(a,['enabled','admission_result','reason','valid_until','execution_authorized','receipt_ref']),checks:a.checks?.map(c=>pick(c,['check_id','required','status',...(c.status==='passed'||c.status==='not-applicable'?[]:['reason','message','repair_diagnostics'])]))};}
  if(route.autonomy_scope)out.autonomy_scope=pick(route.autonomy_scope,['enabled','goal','scenario_refs','acceptance_refs','ui_refs','units','policy_ref','validation_matrix_ref','integration_owner','delivery_artifacts','pending_validation']);
  if(route.autonomy_decisions){const d=route.autonomy_decisions;out.autonomy_decisions={...pick(d,['enabled','effective_revision','policy','decisions','human_review_summary','completion_blockers','handoff_digest']),write_contract_query:'orchestrate autonomy decisions (detail="full" before drafting a decision)'};}
  if(route.rule_load_plan){const p=route.rule_load_plan;out.rule_load_plan={...pick(p,['version','strategy','scope','profile','supplemental_protocols']),load_now:p.load_now?.filter(r=>r.reason!=='selected_dependency'),dependency_rules:p.load_now?.filter(r=>r.reason==='selected_dependency').map(r=>({stage_file:r.stage_file,read_when:'An upstream artifact or producer contract is unclear; completed upstream work is not repeated.'}))};}
  if(route.evidence_reuse_plan)out.evidence_reuse_plan=pick(route.evidence_reuse_plan,['version','strategy','scope','evidence_scope','reuse','verify','revalidate']);
  return out;
}

// Markdown headings in fenced examples are not navigable source sections.
export function ruleSections(content){
  const lines=content.split('\n'),sections=[];let fence=null,front=lines[0]?.trim()==='---';
  for(let i=0;i<lines.length;i++){const line=lines[i];if(front){if(i>0&&line.trim()==='---')front=false;continue;}
    const f=/^\s{0,3}(`{3,}|~{3,})/.exec(line);if(f){if(!fence)fence=f[1];else if(f[1][0]===fence[0]&&f[1].length>=fence.length)fence=null;continue;}if(fence)continue;
    const h=/^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);if(h)sections.push({id:String(i+1),title:h[2],level:h[1].length,start:i});
  }
  return sections.map((s,i)=>({...s,end:sections.slice(i+1).find(n=>n.level<=s.level)?.start??lines.length}));
}
export function ruleView(result,action={}){
  if(typeof result?.content!=='string'||action.detail==='full')return result;
  const sections=ruleSections(result.content),lines=result.content.split('\n');
  if(action.section!==undefined){const selected=sections.find(s=>s.id===action.section);if(!selected)throw Error('HOST_RULE_SECTION_NOT_FOUND');return {...result,view:'section',section:selected.id,content:lines.slice(selected.start,selected.end).join('\n'),source_sha256:result.sha256};}
  const summary=sections.find(s=>s.title==='自主宿主执行摘要');
  if(!summary)return result; // Unannotated rules keep their full established semantics.
  return {...result,view:'execution-summary',content:lines.slice(summary.start,summary.end).join('\n'),sections:sections.filter(s=>s.id!==summary.id).map(s=>({id:s.id,title:s.title,level:s.level})),reading:'This source-authored summary preserves mandatory execution rules. Read applicable detailed sections before acting when needed: rule(path, section=<id>); detail="full" reads the complete original rule.',source_sha256:result.sha256};
}
// Remove only known mechanical provenance. Unknown/business fields (I13 modes,
// omissions, review issue counts, assertion failures) must remain visible.
const evidenceMetadata=new Set(['inputs','baseline_inputs','phase_input_binding','execution_input_binding','source_revision','checker','producer','issuer_provenance','freshness','environment_binding','command_config_digest']);
export function evidenceView(result,action={}){
  if(action.detail==='full'||!/^\.aidlc\/evidence\/.+\.json$/.test(action.path||'')||typeof result?.content!=='string')return result;
  const value=JSON.parse(result.content);if(!value||typeof value!=='object'||Array.isArray(value))return result;
  const summary=Object.fromEntries(Object.entries(value).filter(([k])=>!evidenceMetadata.has(k))),omitted=Object.keys(value).filter(k=>!(k in summary));
  if(!omitted.length)return result;
  return {...result,view:'evidence-summary',content:JSON.stringify(summary),omitted_fields:omitted,reading:'Read with detail="full" for omitted fields, provenance, input bindings or complete review contracts. sha256 always identifies original file bytes.'};
}
export class ModelReadCache{
  constructor(){this.seen=new Map();}
  view(kind,result,action){
    const view=kind==='rule'?ruleView(result,action):evidenceView(result,action);
    if(!result?.sha256||typeof view.content!=='string')return view;
    const key=JSON.stringify([kind,result.path,view.view||'full',action.section||null]);
    // File was read and path-checked again by the caller, even for cache hits.
    if(action.detail!=='full'&&this.seen.get(key)===result.sha256)return {path:result.path,sha256:result.sha256,view:'unchanged',original_view:view.view||'full',reading:'Identical content was returned earlier in this live session. Use detail="full" to reread if it is no longer in context.'};
    this.seen.set(key,result.sha256);return view;
  }
}
