const http=require('node:http'),fs=require('node:fs'),cp=require('node:child_process');
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
