const {test}=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto,createHash}=require('node:crypto');
const {createNativeSync}=require('../src/native-sync');
const fs=require('node:fs'),vm=require('node:vm');
const bytes=s=>Uint8Array.from(Buffer.from(s)).buffer;
const text=b=>Buffer.from(b).toString();
const md5=b=>createHash('md5').update(Buffer.from(b)).digest('hex');
const deps={crypto:()=>webcrypto,md5,isEncrypted:()=>false,encryptData:async b=>b,decryptData:async b=>b,buildMultipartFormData:b=>({body:b,contentType:'multipart/form-data'}),requestUrl:async()=>{throw Error('no mock')},schedule:setTimeout};
const N=createNativeSync(deps);
const r=(path='a.md',id=1,rev='opaque',size=3)=>({path,remotePath:'/root/'+path,fsId:id,size,mtime:1000,md5:rev,isdir:0});
const l=(path='a.md',hash='same')=>({path,hash,mtime:100,size:3});
const baseline=(path='a.md')=>({[path]:{local:l(path),remote:r(path)}});
const actions=(ls,rs,b=baseline())=>N.plan(new Map(ls.map(x=>[x.path,x])),new Map(rs.map(x=>[x.path,x])),b,'/root');
test('three-way planner uses local content and cloud revision, never cloud MD5 as local MD5',()=>{
 assert.equal(actions([l()],[r()]).length,0);
 assert.equal(actions([l('a.md','new')],[r()])[0].action,'UPLOAD');
 assert.equal(actions([l()],[r('a.md',1,'changed')])[0].action,'DOWNLOAD');
 assert.equal(actions([l('a.md','new')],[r('a.md',1,'changed')])[0].action,'CONFLICT');
 assert.equal(actions([l()],[r()],{})[0].action,'VERIFY');
});
test('delete/edit preserves content; unchanged one-sided absence requires delete',()=>{
 assert.equal(actions([l()],[])[0].action,'DELETE_LOCAL');
 assert.equal(actions([],[r()])[0].action,'DELETE_REMOTE');
 assert.equal(actions([l('a.md','edit')],[])[0].action,'UPLOAD');
 assert.equal(actions([],[r('a.md',1,'edit')])[0].action,'DOWNLOAD');
 assert.equal(actions([],[])[0].action,'FORGET');
});
test('unambiguous local rename uses server move, cloud rename uses fs_id',()=>{
 assert.equal(actions([l('new.md')],[r()])[0].action,'MOVE_REMOTE');
 assert.equal(actions([l()],[r('new.md')])[0].action,'MOVE_LOCAL');
 const a=actions([l('b.md'),l('c.md')],[r()]);assert(!a.some(x=>x.action==='MOVE_REMOTE'));
 const b=actions([l()],[r('new.md',2)]);assert(!b.some(x=>x.action==='MOVE_LOCAL'));
});
test('unsafe paths, account root and invalid metadata rejected',()=>{
 for(const path of ['/root/../x','/other/a','/root/a\\b','/root/a//b'])assert.throws(()=>N.relative(path,'/root'));
 for(const path of ['/','abc','/root/../x'])assert.throws(()=>N.basePath(path));
 assert.throws(()=>N.normalize({path:'/root/x',isdir:0,size:1,fs_id:NaN,server_mtime:1},'/root'));
});
test('WebDAV setup path requires a named folder below /WebDAV/',()=>{
 const webdav=p=>p.startsWith('/WebDAV/')&&p.slice(8).length>0&&!p.slice(8).split('/').some(x=>!x||x==='.'||x==='..')?null:'必须在 /WebDAV/ 下填写文件夹名';
 assert.equal(N.basePath('/WebDAV/Obsidian',webdav),'/WebDAV/Obsidian');
 assert.equal(N.basePath('/WebDAV/Obsidian/Sub',webdav),'/WebDAV/Obsidian/Sub');
 for(const path of ['/WebDAV','/WebDAV/','/WebDAV//','/apps/Obsidian','/root'])assert.throws(()=>N.basePath(path,webdav),/WebDAV/);
});
test('listall pagination uses server cursor not offset and honors has_more',async()=>{
 const api=new N.Api({},async()=>{}),calls=[];api.request=async(e,q)=>{calls.push(q.start);return {errno:0,list:[{path:'/apps/test/'+q.start,fs_id:q.start+1,size:1,isdir:0,server_mtime:1}],has_more:q.start===0?1:0,cursor:73};};
 assert.equal((await api.listAll('/apps/test')).size,2);assert.deepEqual(calls,[0,73]);
 api.request=async()=>({errno:0,list:[],has_more:1,cursor:0});await assert.rejects(()=>api.listAll('/apps/test'));
});
test('non-app folder tries listall, then falls back to exact-directory list',async()=>{
 const api=new N.Api({},async()=>{}),paths=[];
 api.request=async()=>{throw Object.assign(Error('restricted'),{errno:-7});};
 api.listDirectory=async path=>{paths.push(path);return path==='/root'?[{path:'/root/d',isdir:1,size:0,fs_id:1,server_mtime:1},{path:'/root/.baidu-native-history',isdir:1,size:0,fs_id:2,server_mtime:1}]:[{path:'/root/d/a',isdir:0,size:1,fs_id:3,server_mtime:1}];};
 assert.equal((await api.listAll('/root')).size,1);assert.deepEqual(paths,['/root','/root/d']);
});
test('listall is used for the current WebDAV root in one page',async()=>{
 const api=new N.Api({},async()=>{});let listCalls=0;api.listDirectory=async()=>{listCalls++;return[];};
 api.request=async()=>({errno:0,has_more:0,cursor:2,list:[{path:'/root/a',isdir:0,size:1,fs_id:1,server_mtime:1},{path:'/root/d',isdir:1,size:0,fs_id:2,server_mtime:1}]});
 assert.equal((await api.listAll('/root')).size,1);assert.equal(listCalls,0);
});
test('list pages cannot silently return partial/duplicate/outside results',async()=>{
 const api=new N.Api({},async()=>{});api.request=async()=>({errno:0});await assert.rejects(()=>api.listDirectory('/root'));
 api.request=async()=>({errno:0,list:[{path:'/other/x'}]});await assert.rejects(()=>api.listDirectory('/root'));
 api.request=async()=>({errno:0,list:[{path:'/root/x'},{path:'/root/x'}]});await assert.rejects(()=>api.listDirectory('/root'));
});
test('ordinary list paginates beyond 1000',async()=>{
 const api=new N.Api({},async()=>{}),starts=[];api.request=async(e,q)=>{starts.push(q.start);return{errno:0,list:q.start?[]:Array.from({length:1000},(_,i)=>({path:'/root/'+i}))};};
 assert.equal((await api.listDirectory('/root')).length,1000);assert.deepEqual(starts,[0,1000]);
});
test('token refresh rebuilds the actual request URL',async()=>{
 let token='old',n=0;const tokens=[];
 const C=createNativeSync({...deps,requestUrl:async p=>{tokens.push(new URL(p.url).searchParams.get('access_token'));return{status:200,json:n++?{errno:0,value:1}:{errno:-6}};}});
 const api=new C.Api({refreshTokenIfNeeded:async force=>{if(force)token='new';return token;}},async()=>{});
 assert.equal((await api.request('https://pan.baidu.com/rest/2.0/xpan/file',{method:'list'})).value,1);assert.deepEqual(tokens,['old','new']);
});
test('HTTP 200 filemanager partial failure and asynchronous task are not success',async()=>{
 const api=new N.Api({},async()=>{});
 for(const d of [{errno:0,info:[{path:'/a',errno:1}]},{errno:0,taskid:123},{errno:0,info:[]}]){api.request=async()=>d;await assert.rejects(()=>api.manage('delete',['/a']));}
});
test('missing parent is absence only for documented -9, never permission failure',async()=>{
 const api=new N.Api({},async()=>{});api.listDirectory=async()=>{throw Object.assign(Error(),{errno:-9});};
 assert.equal(await api.lookup('/root/new/a','/root'),null);await assert.rejects(()=>api.lookup('/root/a','/root'));
 api.listDirectory=async()=>{throw Object.assign(Error(),{errno:-7});};await assert.rejects(()=>api.lookup('/root/new/a','/root'));
});
test('multipart uses uploadid, locateupload, empty block list uploads part 0; resumes stored session',async()=>{
 let forms=[],slices=[],commitGuard=false;
 const C=createNativeSync({...deps,requestUrl:async p=>{const u=new URL(p.url),m=u.searchParams.get('method');
   if(m==='upload'){slices.push(u.searchParams.get('partseq'));return {status:200,json:{md5:md5(p.body)}};}
   const f=p.body?Object.fromEntries(new URLSearchParams(p.body)):{};forms.push([m,f]);
   if(m==='precreate')return{status:200,json:{errno:0,uploadid:'resume',block_list:[]}};
   if(m==='locateupload')return{status:200,json:{error_code:0,host:'c.pcs.baidu.com'}};
   if(m==='create'){assert(commitGuard);return{status:200,json:{errno:0,path:'/root/a',size:3,fs_id:1}};}
 }});
 const api=new C.Api({refreshTokenIfNeeded:async()=> 'fake'},async()=>{}),payload=bytes('abc'),journals={'/root/a':{hash:await N.hash(payload),uploadid:'old-session',at:Date.now()}};
 await api.upload('/root/a',payload,{},journals,async()=>{},async()=>{commitGuard=true;});
 assert.equal(forms[0][1].uploadid,'old-session');assert.deepEqual(slices,['0']);assert.equal(journals['/root/a'],undefined);
});
test('bad slice MD5 prevents commit and preserves resume journal',async()=>{
 let committed=false;
 const C=createNativeSync({...deps,requestUrl:async p=>{const m=new URL(p.url).searchParams.get('method');
 if(m==='upload')return{status:200,json:{md5:'wrong'}};
 if(m==='precreate')return{status:200,json:{errno:0,uploadid:'keep',block_list:[0]}};
 if(m==='locateupload')return{status:200,json:{error_code:0,host:'c.pcs.baidu.com'}};
 if(m==='create')committed=true;
 }});
 const journals={},api=new C.Api({refreshTokenIfNeeded:async()=> 'fake'},async()=>{});
 await assert.rejects(()=>api.upload('/root/a',bytes('abc'),{},journals,async()=>{}));assert(!committed);assert.equal(journals['/root/a'].uploadid,'keep');
});
function fixture(Native=N){
 const files=new Map(),dirs=new Set(['','folder','.obsidian','.obsidian/plugins','.obsidian/plugins/baidu-netdisk-sync']);let tick=1;
 const adapter={exists:async p=>files.has(p)||dirs.has(p),read:async p=>text(files.get(p).b),write:async(p,s)=>{files.set(p,{b:bytes(s),t:++tick});},readBinary:async p=>files.get(p).b.slice(0),writeBinary:async(p,b)=>{files.set(p,{b:b.slice(0),t:++tick});},stat:async p=>files.has(p)?{type:'file',size:files.get(p).b.byteLength,mtime:files.get(p).t}:dirs.has(p)?{type:'folder'}:null,mkdir:async p=>{dirs.add(p)},list:async p=>({files:[...files.keys()].filter(x=>x.slice(0,Math.max(0,x.lastIndexOf('/')))===p),folders:[...dirs].filter(x=>x&&x!==p&&x.slice(0,Math.max(0,x.lastIndexOf('/')))===p)}),trashLocal:async p=>{files.delete(p);return true;}};
 const e={app:{vault:{adapter,configDir:'.obsidian',getAbstractFileByPath:p=>files.has(p)?{path:p}:null},fileManager:{renameFile:async(f,p)=>{files.set(p,files.get(f.path));files.delete(f.path);},trashFile:async f=>{files.delete(f.path)}}},manifest:{manifestFilePath:'.obsidian/plugins/baidu-netdisk-sync/sync_manifest.json'},client:{oauth:{}},filter:{shouldIgnore:p=>p.includes('baidu-netdisk-sync'),updateSettings(){}},isSyncing(){return !['idle','error'].includes(this.state)},state:'idle',setState(s){this.state=s;},addLog(){},getSettings:()=>({remoteBasePath:'/root',appKey:'key'})};
 const runner=new Native.Runner(e);runner.state={version:2,files:{},uploads:{},adopted:true};runner.base='/root';runner.runId='test';runner.settings={};
 return{runner,e,adapter,files,dirs};
}
test('native runner rejects an invalid WebDAV path before scanning',async()=>{
 const webdav=p=>p.startsWith('/WebDAV/')&&p.slice(8).length>0?null:'必须在 /WebDAV/ 下填写文件夹名';
 const W=createNativeSync({...deps,validateSyncPath:webdav});const {runner}=fixture(W);
 runner.api.request=async()=>({errno:0,uk:1});
 await assert.rejects(()=>runner.load({remoteBasePath:'/WebDAV/',appKey:'key'}),/WebDAV/);
 await assert.rejects(()=>runner.load({remoteBasePath:'/root',appKey:'key'}),/WebDAV/);
});
test('local content hash detects changes with same size and timestamp',async()=>{
 const {runner,files}=fixture();files.set('a.md',{b:bytes('aaa'),t:1});const old=await runner.localFile('a.md');files.set('a.md',{b:bytes('bbb'),t:1});await assert.rejects(()=>runner.checkLocal('a.md',old));
});
test('exclusions cannot turn old tracked files into deletion plans',async()=>{
 const {runner}=fixture();runner.scanLocal=async()=>new Map();runner.api.listAll=async()=>new Map();runner.state.files['.claudian/private.md']={local:l(),remote:r()};runner.state.files['.obsidian/plugins/baidu-netdisk-sync/data.json']={local:l(),remote:r()};assert.deepEqual(await runner.scan(),[]);
});
test('cloud read failure does not produce deletion plan or change baseline',async()=>{
 const {runner}=fixture();runner.scanLocal=async()=>new Map([['a.md',l()]]);runner.api.listAll=async()=>{throw Error('403')};runner.state.files=baseline();await assert.rejects(()=>runner.scan());assert(runner.state.files['a.md']);
});
test('cloud rename goes through Obsidian fileManager and migrates baseline',async()=>{
 const {runner,adapter,files}=fixture();await adapter.writeBinary('a.md',bytes('abc'));const local=await runner.localFile('a.md'),remote=r('b.md');runner.state.files['a.md']={local,remote:r()};runner.api.lookup=async p=>p==='/root/b.md'?remote:null;
 await runner.execute({action:'MOVE_LOCAL',path:'b.md',oldPath:'a.md',local,remote});assert(!files.has('a.md'));assert.equal(text(files.get('b.md').b),'abc');assert(!runner.state.files['a.md']);assert(runner.state.files['b.md']);
});
test('local edit after preview prevents delete',async()=>{
 const {runner,adapter,files}=fixture();await adapter.writeBinary('a.md',bytes('abc'));const local=await runner.localFile('a.md');await adapter.writeBinary('a.md',bytes('edit'));runner.api.lookup=async()=>null;
 await assert.rejects(()=>runner.execute({action:'DELETE_LOCAL',path:'a.md',local,remote:null}));assert.equal(text(files.get('a.md').b),'edit');
});
test('initial VERIFY compares bytes, even when opaque remote hash differs',async()=>{
 const {runner,adapter}=fixture();await adapter.writeBinary('a.md',bytes('abc'));const local=await runner.localFile('a.md');runner.api.lookup=async()=>r();runner.api.download=async()=>bytes('abc');await runner.execute({action:'VERIFY',path:'a.md',local,remote:r()});assert.equal(runner.state.files['a.md'].local.hash,local.hash);
});
test('conflicting revisions create a separate file before replacing cloud original',async()=>{
 const {runner,adapter,files}=fixture();await adapter.writeBinary('a.md',bytes('local'));const local=await runner.localFile('a.md'),remote=r('a.md',1,'cloud',6);runner.api.lookup=async p=>p==='/root/a.md'?remote:null;runner.api.download=async()=>bytes('remote');
 const puts=[];runner.put=async(p,b)=>{puts.push([p,text(b)])};await runner.execute({action:'CONFLICT',path:'a.md',local,remote});assert.equal(puts.length,2);assert(puts[0][0].includes('remote-conflict'));assert.equal(puts[0][1],'remote');assert.equal(puts[1][1],'local');assert.equal(text(files.get('a.md').b),'local');
});
test('download with local edits during transfer aborts, preserving local contents',async()=>{
 const {runner,adapter,files}=fixture();await adapter.writeBinary('a.md',bytes('abc'));const local=await runner.localFile('a.md');runner.api.lookup=async()=>r();runner.api.download=async()=>{await adapter.writeBinary('a.md',bytes('user typing'));return bytes('remote')};await assert.rejects(()=>runner.execute({action:'DOWNLOAD',path:'a.md',local,remote:r()}));assert.equal(text(files.get('a.md').b),'user typing');
});
test('first background run is preview only; no baseline adoption or file transfers',async()=>{
 const {runner}=fixture();runner.load=async()=>{runner.state.adopted=false;};runner.scan=async()=>[{action:'UPLOAD',path:'a.md'}];runner.execute=async()=>{throw Error('must not run')};const result=await runner.run({silent:true});assert(result.preview);assert(!runner.state.adopted);
});
test('automatic run holds deletes, manual approved run uses trash',async()=>{
 const {runner}=fixture();runner.load=async()=>{};runner.scan=async()=>[{action:'DELETE_LOCAL',path:'a.md'}];let called=0;runner.execute=async()=>called++;let result=await runner.run({silent:true});assert.equal(called,0);assert.equal(result.stats.pending,1);runner.confirm=async()=>true;result=await runner.run({confirm:true});assert.equal(called,1);assert.equal(result.stats.deleted,1);
});
test('error stops subsequent actions and does not claim complete',async()=>{
 const {runner}=fixture();runner.load=async()=>{};runner.scan=async()=>[{action:'UPLOAD',path:'a'},{action:'UPLOAD',path:'b'}];let called=0;runner.execute=async()=>{called++;throw Error('disk full')};const result=await runner.run({silent:true});assert.equal(called,1);assert.equal(result.success,false);assert.equal(result.stats.errors,1);
});
test('zero plan does not open an empty manual review modal',async()=>{
 const {runner}=fixture();runner.load=async()=>{};runner.scan=async()=>[];let called=0;runner.confirm=async()=>{called++;return true;};const result=await runner.run({confirm:true});assert(result.success);assert.equal(called,0);
});
test('successful sync writes an explicit completion log',async()=>{
 const {runner,e}=fixture();const logs=[];e.addLog=(level,message)=>logs.push([level,message]);runner.load=async()=>{};runner.scan=async()=>[];await runner.run({silent:true});assert(logs.some(([level,message])=>level==='success'&&message.startsWith('同步完成')));
});
test('non-zero sync reports upload and download counts in the completion log',async()=>{
 const {runner,e}=fixture();const logs=[];e.addLog=(level,message)=>logs.push([level,message]);runner.load=async()=>{};runner.scan=async()=>[{action:'UPLOAD',path:'a'}];runner.execute=async()=>{};await runner.run({silent:true});assert(logs.some(([level,message])=>level==='success'&&message==='同步完成：上传 1，下载 0，删除 0'));
});
test('fresh installation adopts identical cloud files without uploading; next scan is empty',async()=>{
 const {runner,adapter}=fixture();await adapter.writeBinary('a.md',bytes('abc'));
 const remote=r();runner.state.files={};runner.state.adopted=false;
 runner.api.listAll=async()=>new Map([['a.md',remote]]);runner.api.lookup=async()=>remote;
 runner.api.download=async()=>bytes('abc');runner.api.upload=async()=>assert.fail('identical files must not upload');
 const items=await runner.scan();assert.equal(items[0].action,'ADOPT');await runner.execute(items[0]);
 runner.api.download=async()=>assert.fail('unchanged baseline should need no download');
 assert.deepEqual(await runner.scan(),[]);
});
test('timestamp-only local change causes no transfer',async()=>{
 const {runner,adapter,files}=fixture();await adapter.writeBinary('a.md',bytes('abc'));const local=await runner.localFile('a.md');
 runner.state.files={'a.md':{local,remote:r()}};files.get('a.md').t+=10000;
 runner.api.listAll=async()=>new Map([['a.md',r()]]);runner.api.download=async()=>assert.fail('must not download');
 assert.deepEqual(await runner.scan(),[]);
});
test('equal current content adopts stale local, remote, or both baselines',async()=>{
 for(const mode of ['local','remote','both']){
  const {runner,adapter}=fixture();await adapter.writeBinary('a.md',bytes('abc'));const local=await runner.localFile('a.md'),remote=r();
  runner.state.files={'a.md':{local:{...local,hash:mode==='remote'?local.hash:'old'},remote:mode==='local'?remote:{...remote,mtime:0}}};
  runner.api.listAll=async()=>new Map([['a.md',remote]]);runner.api.lookup=async()=>remote;runner.api.download=async()=>bytes('abc');
  assert.equal((await runner.scan())[0].action,'ADOPT');
 }
});
test('different content preserves upload/download/conflict directions',async()=>{
 for(const mode of ['UPLOAD','DOWNLOAD','CONFLICT','VERIFY']){
  const {runner,adapter}=fixture();await adapter.writeBinary('a.md',bytes('abc'));const local=await runner.localFile('a.md'),remote=r();
  runner.state.files=mode==='VERIFY'?{}:{'a.md':{local:{...local,hash:mode==='DOWNLOAD'?local.hash:'old'},remote:mode==='UPLOAD'?remote:{...remote,mtime:0}}};
  runner.api.listAll=async()=>new Map([['a.md',remote]]);runner.api.lookup=async()=>remote;runner.api.download=async()=>bytes('xyz');
  assert.equal((await runner.scan())[0].action,mode==='VERIFY'?'CONFLICT':mode);
 }
});
test('new remote target requires review and labels missing files as new',async()=>{
 const {runner,e}=fixture();runner.state.adopted=false;runner.load=async()=>{};
 runner.scan=async()=>[{action:'UPLOAD',path:'a.md',local:l()}];const logs=[];e.addLog=(level,message)=>logs.push(message);
 let reviews=0;runner.confirm=async()=>{reviews++;return false;};runner.execute=async()=>assert.fail('cancelled initial transfer');
 const result=await runner.run({confirm:true});assert(result.cancelled);assert.equal(reviews,1);
 assert(logs.some(x=>x.includes('上传本地新增')));assert(!logs.some(x=>x.includes('上传本地修改')));assert(logs.includes('同步目录：/root'));
});
test('cloud or local change during comparison fails closed',async()=>{
 for(const side of ['local','remote']){
  const {runner,adapter}=fixture();await adapter.writeBinary('a.md',bytes('abc'));runner.state.files={};
  runner.api.listAll=async()=>new Map([['a.md',r()]]);
  runner.api.lookup=async()=>side==='remote'?r('a.md',1,'new'):r();
  runner.api.download=async()=>{if(side==='local')await adapter.writeBinary('a.md',bytes('edit'));return bytes('abc');};
  await assert.rejects(()=>runner.scan());assert.deepEqual(runner.state.files,{});
 }
});
test('automatic sync holds conflicts and never auto-duplicates them',async()=>{
 const {runner,e}=fixture();const logs=[];e.addLog=(level,message)=>logs.push([level,message]);runner.load=async()=>{};let executed=0;runner.scan=async()=>[{action:'CONFLICT',path:'a.md',local:l('a.md'),remote:r('a.md')}];runner.execute=async()=>{executed++;};const result=await runner.run({silent:true});assert.equal(executed,0);assert.equal(result.stats.conflicts,1);assert.equal(result.success,false);assert(logs.some(([level,message])=>level==='warn'&&message.includes('1 项冲突待处理')));
});
test('manual conflict choices map to upload, download, both and skip',async()=>{
 const {runner}=fixture();runner.load=async()=>{};const items=['a.md','b.md','c.md','d.md'].map(path=>({action:'CONFLICT',path,local:l(path),remote:r(path)}));runner.scan=async()=>items;runner.chooseConflicts=async(cs)=>cs.map((item,index)=>({item,choice:['local','remote','both','skip'][index]}));const actions=[];runner.execute=async(x)=>actions.push(x.action);const result=await runner.run({confirm:false});assert.deepEqual(actions,['UPLOAD','DOWNLOAD','CONFLICT']);assert.equal(result.stats.conflicts,1);assert.equal(result.success,false);
});
test('startup auto sync prompts for conflicts instead of waiting for manual sync',async()=>{
 const {runner}=fixture();runner.load=async()=>{};const item={action:'CONFLICT',path:'a.md',local:l('a.md'),remote:r('a.md')};runner.scan=async()=>[item];let prompted=0;runner.chooseConflicts=async(cs)=>{prompted++;return cs.map(x=>({item:x,choice:'local'}));};const actions=[];runner.execute=async(x)=>actions.push(x.action);const result=await runner.run({silent:true,trigger:'启动自动'});assert.equal(prompted,1);assert.deepEqual(actions,['UPLOAD']);assert.equal(result.success,true);
});
test('rename journal coalesces chains and cancels a rename back to the original path',async()=>{
 const {runner}=fixture();await runner.recordRename('A.md','B.md','file');await runner.recordRename('B.md','C.md','file');assert.deepEqual((await runner.loadRenames()).map(e=>[e.oldPath,e.newPath]),[['A.md','C.md']]);await runner.recordRename('A.md','B.md','file');await runner.recordRename('B.md','A.md','file');assert.equal((await runner.loadRenames()).length,0);
});
test('concurrent rename events are serialized and do not overwrite the journal',async()=>{
 const {runner}=fixture();await Promise.all([runner.recordRename('A.md','B.md','file'),runner.recordRename('C.md','D.md','file'),runner.recordRename('E.md','F.md','file')]);const got=(await runner.loadRenames()).map(e=>e.oldPath).sort();assert.deepEqual(got,['A.md','C.md','E.md']);
});
test('file rename journal uses the cloud rename API and rebases the baseline',async()=>{
 const {runner,adapter}=fixture();runner.base='/root';await adapter.writeBinary('B.md',bytes('abc'));const oldRemote={path:'A.md',remotePath:'/root/A.md',fsId:123,size:3,mtime:1,md5:'old',isdir:0};const newRemote={...oldRemote,path:'B.md',remotePath:'/root/B.md'};let moved=false;runner.api.lookup=async p=>p==='/root/A.md'?(moved?null:oldRemote):p==='/root/B.md'?(moved?newRemote:null):null;runner.api.manage=async(op,items,opts)=>{assert.equal(op,'rename');assert.equal(items[0].newname,'B.md');assert.equal(opts.allowTask,false);moved=true;return{errno:0,info:[{errno:0,path:'/root/A.md'}]}};runner.state={version:2,files:{'A.md':{local:l('A.md','oldhash'),remote:oldRemote}},uploads:{}};await runner.applyRename({oldPath:'A.md',newPath:'B.md',kind:'file'});assert(!runner.state.files['A.md']);assert.equal(runner.state.files['B.md'].remote.fsId,123);assert.equal(runner.state.files['B.md'].local.hash,'oldhash');
});
test('folder rename rebases all baseline paths under the old prefix',async()=>{
 const {runner,adapter,dirs}=fixture();runner.base='/root';dirs.add('B');await adapter.writeBinary('B/x.md',bytes('x'));await adapter.writeBinary('B/y.md',bytes('y'));const oldF={path:'A',remotePath:'/root/A',fsId:10,size:0,mtime:1,md5:'',isdir:1};const newF={...oldF,path:'B',remotePath:'/root/B'};let moved=false;runner.api.lookup=async p=>p==='/root/A'?(moved?null:oldF):p==='/root/B'?(moved?newF:null):null;runner.api.manage=async(op)=>{moved=true;return{errno:0,info:[{errno:0,path:'/root/A'}]}};runner.state={version:2,files:{'A/x.md':{local:l('A/x.md','x'),remote:r('A/x.md',1,'x')},'A/y.md':{local:l('A/y.md','y'),remote:r('A/y.md',2,'y')}},uploads:{}};await runner.applyRename({oldPath:'A',newPath:'B',kind:'folder'});assert(!runner.state.files['A/x.md']);assert(!runner.state.files['A/y.md']);assert.equal(runner.state.files['B/x.md'].local.path,'B/x.md');assert.equal(runner.state.files['B/y.md'].remote.fsId,2);
});
test('state write failures propagate and corrupt state never silently resets',async()=>{
 const {runner,adapter}=fixture();adapter.write=async()=>{throw Error('disk full')};await assert.rejects(()=>runner.persist());adapter.exists=async()=>true;adapter.read=async()=>'{broken';runner.api.request=async()=>({errno:0,uk:123});await assert.rejects(()=>runner.load({remoteBasePath:'/root',appKey:'key'}));
});
test('bundle exports plugin and routes sync through the native reconciler',async()=>{
 const bundle=fs.readFileSync(__dirname+'/../main.js','utf8');
 assert(!bundle.includes('已保留云端旧版本'));assert(!bundle.includes('backupRemote'));
 assert(bundle.includes('startupGraceUntil'));assert(bundle.includes('_lastStartupSync'));
 const stub=new Proxy({Plugin:class{},Modal:class{},PluginSettingTab:class{}},{get:(o,k)=>o[k]||class{}});
 const ctx={module:{exports:{}},exports:{},require:()=>stub,TextEncoder,TextDecoder,Uint8Array,URL,URLSearchParams,console,setTimeout,clearTimeout};vm.runInNewContext(bundle,ctx);assert.equal(typeof ctx.module.exports.default,'function');assert.equal(typeof ctx.SyncEngine.prototype.previewNative,'function');assert(ctx.SyncEngine.prototype.startSync.toString().includes('nativeRunner'));await assert.rejects(()=>ctx.SyncEngine.prototype.writeRemoteIndex());
});

