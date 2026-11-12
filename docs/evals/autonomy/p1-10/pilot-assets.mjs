// Internal pilot inputs. Defective starters are deliberately separate from frozen oracles.
export const requirements = {
  orders: `# SCENARIO-001 Ordered order export

## REQ-001 Ordered pagination
Fetch the complete ordered upstream list exactly once and preserve every row and value in order. Return pages of 50; return [] for empty input. Propagate the original upstream timeout/error object unchanged. No UI is in scope. No network stub may replace the acceptance upstream.

## AC-001 Pagination and failure acceptance
120 rows produce 50/50/20. Also verify 0, 1, 49, 50, 51, 100 and 101 rows; flattening must equal the entire original ordered list. A real upstream timeout must reach the caller unchanged, without partial results. Repeated calls are independent.

## GAP-001 Compatible internal decomposition
The implementation's internal helper layout is unspecified. The Agent may use a single function or private helper while retaining the exported exportOrders(upstream) interface and all REQ-001 behavior. Record the choice, implementation and validation for later human review. This does not authorize changing pagination, ordering or failure propagation.
`,
  publish: `# SCENARIO-001 Publish an item

## REQ-001 Publish behavior
An editor can publish a ready item through the real POST /publish API, see the published state and open View result at /result. Draft items show a disabled Publish button AND the API rejects direct draft publication with status 400 and error not-ready. A transient failure shows Failed. Please retry. and an enabled Retry button; retry succeeds. Do not implement success by changing only the DOM. The result API must confirm published=true and state=published. The service runs only on loopback; production deployment is outside this batch.

## AC-001 Publish acceptance
Verify ready, draft, published, error and retry states at 800x600 and 390x844 for editor. Verify real API statuses and result persistence within the service lifetime. Verify the whole frozen panel and required controls against the independent design HTML/PNG. A missing control, disabled retry, accepting drafts or a mismatched image must fail.

## PAGE-001 Publish item
The frozen design defines one page with a title, Publish/Retry/Published control and result message/link. Ready text is Ready to publish.; draft text is Draft cannot publish.; error text is Failed. Please retry.; published link text is View result. The panel is 346 pixels wide including padding and border, 40 pixels below the viewport top, centered horizontally. Use Arial and the supplied colors/spacing. There are no external assets or fonts. The result endpoint is part of the existing local service.

## GAP-001 Retry error detail
Recoverable API failure detail beyond the specified visible error text is unspecified. The Agent may retain the standard visible message and put diagnostic details in the console, without changing the visible error, retry behavior or acceptance. Record and verify this choice; later human review may revise the diagnostic detail only.
`,
};
export function hasNoPendingPagePlanItems(text) {
  const sections=[...text.matchAll(/(?:^|\n)## 未决项[ \t]*\r?\n([\s\S]*?)(?=\r?\n## |$)/g)];
  return sections.length===1&&/^(无|none)$/i.test(sections[0][1].trim());
}

export const style = 'body{margin:0;background:#f3f4f6;color:#162032;font:16px Arial}main{margin:40px auto;padding:32px;background:white;border:1px solid #d8dce3;border-radius:12px;max-width:280px}h1{font-size:24px;margin:0 0 20px}button{background:#2159c5;color:white;border:0;border-radius:6px;padding:12px 24px;font:16px Arial}button:disabled{background:#8392a8}#result{margin-top:20px;min-height:24px}a{color:#2159c5}';
export function referenceHtml(state) {
  if (!['ready','draft','published','error'].includes(state)) throw Error('Unknown reference state');
  const disabled = ['draft','published'].includes(state) ? ' disabled' : '';
  const label = state === 'published' ? 'Published' : state === 'error' ? 'Retry' : 'Publish';
  const result = state === 'published' ? '<a href="/result">View result</a>' : state === 'error' ? 'Failed. Please retry.' : state === 'draft' ? 'Draft cannot publish.' : 'Ready to publish.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Publish item</title><style>${style}</style></head><body data-role="editor" data-state="${state}"><main data-page="PAGE-001"><h1>Publish item</h1><button id="publish"${disabled}>${label}</button><div id="result">${result}</div></main></body></html>`;
}

export const ordersSeed = '// REQ-001: deliberately defective baseline; Agent must write real RED tests and repair it.\nexports.exportOrders = async upstream => [await upstream()];\n';
export const publishSeed = `// REQ-001: deliberately defective baseline; drafts are incorrectly accepted.
exports.publish = data => data.fail ? {status:503,body:{error:'retryable'}} : {status:200,body:{state:'published',result:'/result'}};
`;
export const webSeed = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Broken publish baseline</title></head><body><h1>Publish item</h1><button id="publish">Publish</button><div id="result">Not implemented</div></body></html>\n';

// Frozen service transport. It executes the candidate's implementation; no business solution is embedded here.
export const server = `const http=require('node:http'),fs=require('node:fs'),cp=require('node:child_process');
const commit=cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();let published=false;
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://local');res.setHeader('connection','close');res.setHeader('content-type','application/json');
if(u.pathname==='/version')return res.end(JSON.stringify({ready:true,version_digest:'p110-upstream-v1',candidate_commit:commit,owner:'internal-pilot'}));
if(u.pathname==='/upstream'){const count=Number(u.searchParams.get('count')??120);if(!Number.isInteger(count)||count<0||count>1000){res.statusCode=400;return res.end(JSON.stringify({error:'invalid-count'}));}return res.end(JSON.stringify(Array.from({length:count},(_,id)=>({id,label:'order-'+id}))));}
if(u.pathname==='/slow')return setTimeout(()=>res.end('[]'),200);
if(u.pathname==='/publish'&&req.method==='POST'){let body='';for await(const b of req)body+=b;delete require.cache[require.resolve('../src/publish.cjs')];const out=require('../src/publish.cjs').publish(JSON.parse(body||'{}'));res.statusCode=out.status;if(out.status===200)published=true;return res.end(JSON.stringify(out.body));}
if(u.pathname==='/result')return res.end(JSON.stringify({published,state:published?'published':'pending'}));
if(u.pathname==='/'){res.setHeader('content-type','text/html');return res.end(fs.readFileSync('src/web.html'));}
if(u.pathname==='/favicon.ico'){res.statusCode=204;return res.end();}
res.statusCode=404;res.end(JSON.stringify({error:'not-found'}));}catch(e){res.statusCode=500;res.end(JSON.stringify({error:String(e)}));}});
server.listen(Number(process.env.PILOT_PORT||0),'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port,candidate_commit:commit})));process.on('SIGTERM',()=>server.close());
`;

// Real assertions. The oracle is frozen outside the native implementation's write scope.
export const ordersOracle = `const assert=require('node:assert/strict');
exports.check=async function(exportOrders,origin){const cases=[];for(const n of [0,1,49,50,51,100,101,120]){const rows=Array.from({length:n},(_,id)=>({id,label:'order-'+id}));const expected=structuredClone(rows);let calls=0;const pages=await exportOrders(async()=>{calls++;return rows;});const sizes=Array.from({length:Math.ceil(n/50)},(_,i)=>Math.min(50,n-i*50));assert.deepEqual(pages.map(p=>p.length),sizes);assert.deepEqual(pages.flat(),expected);assert.equal(calls,1);cases.push({count:n,sizes});}
const original=Object.assign(new Error('upstream timeout'),{code:'ETIMEDOUT'});await assert.rejects(exportOrders(async()=>{throw original;}),e=>e===original);
if(!origin)throw Error('PILOT_ORIGIN is required; runtime upstream cannot be skipped');const expectedRows=Array.from({length:120},(_,id)=>({id,label:'order-'+id}));let runtimeCalls=0;const pages=await exportOrders(async()=>{runtimeCalls++;const response=await fetch(origin+'/upstream');assert.equal(response.status,200);const rows=await response.json();assert.deepEqual(rows,expectedRows);return rows;});assert.equal(runtimeCalls,1);assert.deepEqual(pages.map(p=>p.length),[50,50,20]);assert.deepEqual(pages.flat(),expectedRows);
let timeout;await assert.rejects(exportOrders(async()=>{try{await fetch(origin+'/slow',{signal:AbortSignal.timeout(20)});return [];}catch(e){timeout=e;throw e;}}),e=>e===timeout);assert.ok(timeout,'real upstream must time out inside the export invocation');
return {sizes:pages.map(p=>p.length),flattened:pages.flat(),cases,timeout:'propagated-original',runtime:'actual-http'};};
if(require.main===module)exports.check(require('../src/orders.cjs').exportOrders,process.env.PILOT_ORIGIN).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});
`;

export const publishOracle = `const assert=require('node:assert/strict');
exports.check=async function(origin){if(!origin)throw Error('PILOT_ORIGIN required');const post=async data=>{const r=await fetch(origin+'/publish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});return {status:r.status,body:await r.json()};};
const draft=await post({state:'draft'});assert.equal(draft.status,400);assert.equal(draft.body.error,'not-ready');const failure=await post({state:'ready',fail:true});assert.equal(failure.status,503);assert.equal(failure.body.error,'retryable');const ready=await post({state:'ready'});assert.equal(ready.status,200);assert.equal(ready.body.state,'published');assert.equal(ready.body.result,'/result');const r=await fetch(origin+ready.body.result),result=await r.json();assert.equal(r.status,200);assert.equal(result.published,true);assert.equal(result.state,'published');return {draft,failure,ready,result};};
if(require.main===module)exports.check(process.env.PILOT_ORIGIN).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});
`;
