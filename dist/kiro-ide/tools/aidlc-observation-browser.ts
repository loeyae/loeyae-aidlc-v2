/** Operation-scoped Chrome reuse; every observation owns an independent browser context. */
import {BrowserSession} from './aidlc-browser-session';import {createRequire} from 'node:module';
export {waitForDevToolsPort} from './aidlc-browser-session';const R=createRequire(import.meta.url)('./aidlc-owned-resource.cjs');type Row=Record<string,any>;
const delay=(n:number)=>new Promise(r=>setTimeout(r,n));
async function observePage(session:BrowserSession,c:Row,url:string,spec:Row,deadline:number):Promise<Row>{
 const network:Row[]=[],errors:Row[]=[],call=(method:string,params:Row={})=>session.call(method,params,deadline,c.session_id);
 const unsubscribe=session.subscribe(c,m=>{if(m.method==='Network.responseReceived')network.push({url:m.params.response.url,type:m.params.type,status:m.params.response.status,from_disk_cache:m.params.response.fromDiskCache===true,from_service_worker:m.params.response.fromServiceWorker===true});else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);});
  const evaluate = async (expression: string) => {
    const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error("BROWSER_EVALUATION_FAILED");
    return r.result.value;
  };
  const element = async (selector: string) =>
    evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return {exists:false};const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {exists:true,text:e.textContent,value:e.value??null,disabled:!!e.disabled,visible:r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none',rect:{x:r.x,y:r.y,width:r.width,height:r.height},attributes:Object.fromEntries([...e.attributes].map(a=>[a.name,a.value]))};})()`,
    );
  const expect = async (items: Row[], wait = true) => {
    const end = Math.min(deadline, Date.now() + 5000);
    let rows: Row[] = [];
    do {
      rows = [];
      for (const e of items) {
        const actual = await element(e.selector),
          value = e.property === "attribute" ? actual.attributes?.[e.name] : actual[e.property];
        rows.push({ ...e, actual: value ?? null, passed: JSON.stringify(value) === JSON.stringify(e.expected) });
      }
      if (rows.every((r) => r.passed) || !wait) break;
      await delay(30);
    } while (Date.now() < end);
    return rows;
  };

 try{
    await call("Page.enable");
    await call("Runtime.enable");
    await call("Network.enable");
    await call("Network.setCacheDisabled",{cacheDisabled:true});
    await call("Network.setBypassServiceWorker",{bypass:true});
    await call("Emulation.setDeviceMetricsOverride", { ...spec.viewport, deviceScaleFactor: 1, mobile: false });
    await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    const nav = await call("Page.navigate", { url });
    if (nav.errorText) throw Error("UI_NAVIGATION_FAILED");
    while (!(await evaluate("document.readyState==='complete'"))) {
      if (Date.now() >= deadline) throw Error("UI_LOAD_TIMEOUT");
      await delay(25);
    }
    await evaluate("document.fonts.ready.then(()=>Promise.all([...document.images].map(i=>i.decode())))");
    const initial = await expect(spec.initial_expectations || []),
      steps: Row[] = [];
    for (const step of spec.steps || []) {
      const hit = await element(step.selector);
      if (!hit.exists || !hit.visible || hit.disabled) throw Error("UI_TARGET_NOT_INTERACTABLE: " + step.selector);
      const x = hit.rect.x + hit.rect.width / 2,
        y = hit.rect.y + hit.rect.height / 2;
      const top = await evaluate(
        `(()=>{const e=document.elementFromPoint(${x},${y}),t=document.querySelector(${JSON.stringify(step.selector)});return !!e&&!!t&&(t===e||t.contains(e));})()`,
      );
      if (!top) throw Error("UI_TARGET_OCCLUDED");
      await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      if (step.action === "type") await call("Input.insertText", { text: step.text });
      const checks = await expect(step.expectations);
      steps.push({ action: step.action, selector: step.selector, x, y, checks });
    }
    const final = await expect(spec.expectations),
      dom = await evaluate("document.documentElement.outerHTML");
    if (new URL(await evaluate("location.href")).origin !== new URL(url).origin)
      throw Error("UI_REDIRECT_OUTSIDE_ENVIRONMENT");
    await evaluate("document.fonts.ready.then(()=>Promise.all([...document.images].map(i=>i.decode())))");
    const capture = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const image = Buffer.from(capture.data, "base64");
    const failedAssets = network.filter(
      (n) => ["Stylesheet", "Script", "Image", "Font"].includes(n.type) && n.status >= 400,
    );
    return {
      url,
      viewport: spec.viewport,
      initial,
      steps,
      final,
      dom,
      network,
      errors,
      failed_assets: failedAssets,
      image,
      passed:
        [...initial, ...steps.flatMap((s) => s.checks), ...final].every((r) => r.passed) &&
        !errors.length &&
        !failedAssets.length,
    };

 }finally{unsubscribe();}
}
export function createBrowserObserver(browser:string,options:Row={}){
 if(options.owner!==undefined&&(typeof options.owner!=='string'||!options.owner||options.owner.length>180))throw Error('RESOURCE_OWNER_INVALID');
 const limits=R.resourceLimits(options.limits),deadline=options.deadline_at??Date.now()+300000;
 if(!Number.isFinite(deadline)||deadline<=Date.now())throw Error('BROWSER_DEADLINE_INVALID');
 let session:BrowserSession|undefined,busy=false,closed=false,closing:Promise<any>|undefined;
 return {
  async observe(url:string,spec:Row,timeout=15000):Promise<Row>{
   if(closed||busy)throw Error('BROWSER_CASE_NOT_AVAILABLE');if(!Number.isSafeInteger(timeout)||timeout<1||timeout>2147483647)throw Error('BROWSER_DEADLINE_INVALID');const end=Math.min(deadline,Date.now()+timeout);if(end<=Date.now())throw Error('BROWSER_DEADLINE_INVALID');busy=true;let c:Row|undefined;
   try{if(!session){session=new BrowserSession(browser,{...options,limits,deadline_at:deadline});await session.start(end);}c=await session.openCase(end);const start=performance.now();let raw;try{raw=await observePage(session,c,url,spec,end);}finally{session.metrics.observation_ms+=performance.now()-start;}const finished=c;c=undefined;const isolation=await session.closeCase(finished);return {...raw,browser_session_id:session.id,case_isolation:isolation};}
   finally{try{if(c&&session)await session.closeCase(c);}finally{busy=false;}}
  },
  close(){closed=true;if(!closing)closing=session?session.close():Promise.resolve({reconciled:true,resources:[],metrics:{browser_startups:0,contexts_created:0,contexts_disposed:0}});return closing;},
  get metrics(){return session?{...session.metrics}:{browser_startups:0,contexts_created:0,contexts_disposed:0};}
 };
}
export async function observeBrowser(browser:string,url:string,spec:Row,timeout=15000,options:Row={}):Promise<Row>{
 const observer=createBrowserObserver(browser,options);try{return await observer.observe(url,spec,timeout);}finally{const closed=await observer.close();if(!closed.reconciled)throw Object.assign(Error('BROWSER_RESOURCES_UNRECONCILED'),{resource_reconciliation:closed});}
}
