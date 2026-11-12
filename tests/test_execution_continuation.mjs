/** Independent temporal truth table, no project/runtime/approval fixture. */
import assert from 'node:assert/strict';import {createRequire} from 'node:module';import fs from 'node:fs';
const {decideExecutionContinuation:D}=createRequire(import.meta.url)('../core/tools/aidlc-execution-continuation.cjs');
const base={now:1000000,deadline_at:4600000,required_ms:610000,available_until:1900000},rows=[];
for(const [id,patch,expected,reason]of [
 ['CT-01',{},'continue','current-window-sufficient'],
 ['CT-02',{available_until:1610000},'continue','current-window-sufficient'],
 ['CT-03',{available_until:1609999},'reprobe','current-window-insufficient'],
 ['CT-04',{available_until:1000000},'reprobe','current-window-expired'],
 ['CT-05',{available_until:undefined,status:'refresh-required'},'reprobe','current-receipt-unavailable'],
 ['CT-06',{deadline_at:1000000},'stop','original-deadline-expired'],
 ['CT-07',{deadline_at:1609999},'stop','original-budget-insufficient'],
 ['CT-08',{pending:true},'stop','operations-unreconciled'],
 ['CT-09',{unknown:true},'stop','operations-unreconciled'],
 ['CT-10',{stop_reason:'revoked'},'stop','revoked'],
 ['CT-11',{status:'blocked'},'stop','current-context-blocked'],
 ['CT-12',{available_until:1609999,refresh_attempts:1},'stop','refresh-window-insufficient'],
 ['CT-13',{available_until:1609999,phase:'publication'},'stop','publication-window-insufficient'],
 ['CT-14',{available_until:1609999,refreshable:false},'stop','refresh-not-permitted'],
 ['CT-15',{required_ms:NaN},'stop','continuation-input-invalid'],
 ['CT-16',{deadline_at:1600000,required_ms:590000,available_until:1600000},'continue','current-window-sufficient'],
 ['CT-17',{available_until:NaN},'stop','current-window-unknown'],
]){const result=D({...base,...patch});assert.equal(result.decision,expected,id);assert.equal(result.reason,reason,id);assert.equal(result.execution_authorized,false);rows.push({id,expected,actual:result});console.log('PASS '+id+' '+expected+' '+reason);}
if(process.env.AIDLC_EVAL_DIR){fs.mkdirSync(process.env.AIDLC_EVAL_DIR,{recursive:true});fs.writeFileSync(process.env.AIDLC_EVAL_DIR+'/paths.json',JSON.stringify({kind:'pure-decision-boundaries',business_verified:false,rows},null,2)+'\n');}
