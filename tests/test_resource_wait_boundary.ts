/** A short synthetic handle, never an OS process. No model, workflow or pilot. */
import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {stopService} from '../docs/evals/autonomy/p1-10/prepare-pilots';
const child:any=new EventEmitter();child.pid=undefined;child.exitCode=null;child.signalCode=null;child.kill=()=>true;
const started=Date.now();
const outcome=await Promise.race([stopService(child).then(()=>({kind:'resolved'}),error=>({kind:'rejected',error:String(error)})),new Promise<{kind:string}>(resolve=>setTimeout(()=>resolve({kind:'unbounded'}),150))]);
assert.notEqual(outcome.kind,'unbounded','Service cleanup must refuse unowned handles or finish within its declared cleanup deadline');
assert.ok(Date.now()-started<1000);console.log('PASS unknown service handle cannot create an unbounded close wait');
