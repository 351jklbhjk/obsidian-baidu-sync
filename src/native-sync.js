/* Native Baidu API reconciliation. Bundled by build-native.py. No shared index. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- Baidu API responses are dynamic and this module is the untyped transport boundary. */
function createNativeSync(deps) {
  const {requestUrl, md5, encryptData, decryptData, isEncrypted, buildMultipartFormData, crypto, Modal, Setting, Platform = {isWin:false}, schedule, validateSyncPath = () => null} = deps;
  if (typeof schedule !== "function") throw new Error("schedule dependency required");
  const sleep = ms => new Promise(r => schedule(r, ms));
  const hasControl = s => Array.from(String(s)).some(ch => ch.charCodeAt(0) < 32);
  const fail = message => { throw new Error(message); };
  const safeError = e => String(e?.message || e).replace(/(access_token|refresh_token|client_secret)=[^&\s]+/gi, '$1=[redacted]');
  const hash = async b => Array.from(new Uint8Array(await crypto().subtle.digest('SHA-256', b)), n => n.toString(16).padStart(2,'0')).join('');
  const basePath = (p, validate = () => null) => {
    if (typeof p !== 'string' || !p.startsWith('/') || p.includes('\\') || hasControl(p)) fail('无效云端根目录');
    const v = p.replace(/\/+$/, '');
    if (!v || v.split('/').slice(1).some(x => !x || x === '.' || x === '..')) fail('请选择独立同步目录，不能使用网盘根目录');
    const pathError = validate(v);
    if (pathError) fail(pathError);
    return v;
  };
  const relative = (p, base) => {
    if (typeof p !== 'string' || !p.startsWith(base + '/')) fail('API 返回同步目录之外的路径');
    const r = p.slice(base.length+1);
    if (r.split('/').some(x => !x || x==='.' || x==='..') || r.includes('\\') || hasControl(r)) fail('API 返回不安全路径');
    return r;
  };
  const reserved = p => p === '.baidu-sync-index.json' || p.startsWith('.baidu-native-') || p.startsWith('.claudian/') || p === '.claudian' || p.startsWith('.agents/') || p === '.agents' || p.startsWith('.sync-vault/') || p === '.sync-vault';
  const stamp = r => r ? JSON.stringify([String(r.fsId), r.size, r.mtime, r.md5 || '']) : null;
  const sameRemote = (a,b) => stamp(a) === stamp(b);
  const labels={ADOPT:'内容一致，建立同步记录',VERIFY:'核对两端内容',UPLOAD:'上传本地修改',DOWNLOAD:'下载云端修改',CONFLICT:'冲突：保留双方版本',MOVE_LOCAL:'同步云端重命名到本地',MOVE_REMOTE:'同步本地重命名到云端',DELETE_LOCAL:'移入本地回收站',DELETE_REMOTE:'移入网盘回收站',FORGET:'清理已不存在文件的同步记录'};
  const itemLabel = x => x.action==='UPLOAD'&&!x.remote?'上传本地新增':x.action==='DOWNLOAD'&&!x.local?'下载云端新增':labels[x.action];
  const conflictChoices={local:'保留本地',remote:'保留云端',both:'保留双方',skip:'跳过'};
  const normalize = (f, base) => {
    const path = relative(f.path, base);
    if (![0,1].includes(f.isdir) || !Number.isSafeInteger(f.fs_id) || f.fs_id<=0 || !Number.isFinite(f.server_mtime) || !Number.isSafeInteger(f.size) || f.size<0) fail('云端文件信息不完整，停止同步');
    return {path,remotePath:f.path,fsId:f.fs_id,size:f.size,mtime:f.server_mtime*1000,md5:f.md5 || '',isdir:f.isdir};
  };

  class Api {
    constructor(oauth, pause = sleep) { this.oauth=oauth; this.pause=pause; this.nextListAll=0; }
    async request(endpoint, query, form, options={}) {
      let last;
      for(let attempt=0;attempt<4;attempt++) {
        const token=await this.oauth.refreshTokenIfNeeded();
        const url=new URL(endpoint);
        for(const [k,v] of Object.entries({...query,access_token:token})) url.searchParams.set(k,String(v));
        let response;
        try {
          response=await requestUrl({url:url.toString(),method:form?'POST':'GET',headers:{'User-Agent':'pan.baidu.com',...(form?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(form?{body:new URLSearchParams(form).toString()}:{}),throw:false});
        } catch { last=new Error('网络请求失败'); if(options.noRetry) throw last; await this.pause(1000*2**attempt);continue; }
        let data; try { data=response.json; } catch { fail('API 响应不是 JSON'); }
        const errno=data?.errno ?? data?.error_code;
        if(response.status===200 && errno===0) return data;
        last=Object.assign(new Error(`百度 API ${query.method}: HTTP ${response.status}, code ${errno}`),{errno,status:response.status});
        if([110,111,-6].includes(errno) && attempt<3) { await this.oauth.refreshTokenIfNeeded(true); continue; }
        if(options.noRetry || !([429,500,502,503,504].includes(response.status) || [31034,42000].includes(errno))) throw last;
        await this.pause(errno===31034 ? 8000*(attempt+1) : 1000*2**attempt);
      }
      throw last || new Error('API 请求失败');
    }
    async listDirectory(dir) {
      const rows=[],seen=new Set();
      for(let start=0,page=0;page<10000;page++) {
        const d=await this.request('https://pan.baidu.com/rest/2.0/xpan/file',{method:'list',dir,order:'name',desc:0,start,limit:1000,web:0,folder:0});
        const body=d.data && !d.list ? d.data : d;
        if(body.errno && body.errno!==0) fail('目录列表包含业务错误');
        if(!Array.isArray(body.list)) fail('目录列表缺少 list，拒绝部分扫描结果');
        for(const f of body.list) { relative(f.path,dir); if(f.path.slice(dir.length+1).includes('/')) fail('非递归接口返回了非直接子项'); if(seen.has(f.path)) fail('目录分页重复，目录可能正在变化'); seen.add(f.path);rows.push(f); }
        if(body.has_more===0 || (body.has_more===undefined && body.list.length<1000)) return rows;
        if(!body.list.length) fail('目录分页没有进展');
        start+=body.list.length;
      }
      fail('目录分页超过限制');
    }
    async listAll(base, progress=()=>{}) {
      const files=new Map(),seen=new Set();let pages=0;
      const add=f=>{const r=normalize(f,base); if(seen.has(r.path)) fail('云端分页重复，停止本轮同步');seen.add(r.path);if(!r.isdir) files.set(r.path,r);};
      // The documented listall restriction is /apps, but it is accepted for the current WebDAV share.
      // Try the single recursive endpoint first; fall back to exact-directory list when the server refuses it.
      try {
        let cursor=0; const cursors=new Set([0]);
        for(let page=0;page<10000;page++) {
          await this.pause(Math.max(0,this.nextListAll-Date.now()));this.nextListAll=Date.now()+8000;
          const d=await this.request('https://pan.baidu.com/rest/2.0/xpan/multimedia',{method:'listall',path:base,recursion:1,start:cursor,limit:1000,order:'name',desc:0,web:0});
          if(!Array.isArray(d.list)||![0,1].includes(d.has_more)) fail('递归列表缺少完整分页标识');
          d.list.forEach(add);
          if(!d.has_more) {progress({pages:++pages,files:files.size,mode:'listall',done:true});return files;}
          progress({pages:++pages,files:files.size,mode:'listall'});
          if(!Number.isSafeInteger(d.cursor)||cursors.has(d.cursor)||!d.list.length) fail('递归分页游标无效');
          cursor=d.cursor;cursors.add(cursor);
        }
        fail('递归分页超过限制');
      } catch(e) {
        if(![-7,-9,42213,31066].includes(e.errno)) throw e;
        files.clear();seen.clear();
      }
      const dirs=[base];
      for(let i=0;i<dirs.length;i++) {
        if(i>20000) fail('目录数量超过限制');
        for(const f of await this.listDirectory(dirs[i])) {
          add(f);
          if(f.isdir===1 && !reserved(relative(f.path,base)) && !relative(f.path,base).startsWith('.trash')) dirs.push(f.path);
        }
        progress({pages:++pages,files:files.size,mode:'list'});
      }
      progress({pages,files:files.size,mode:'list',done:true});
      return files;
    }
    async lookup(path,base) {
      const parent=path.slice(0,path.lastIndexOf('/'));
      let rows;
      try {rows=await this.listDirectory(parent);} catch(e){if(e.errno===-9 && parent!==base)return null;throw e;}
      const found=rows.find(f=>f.path===path);
      return found?normalize(found,base):null;
    }
    async meta(fsId) {
      const d=await this.request('https://pan.baidu.com/rest/2.0/xpan/multimedia',{method:'filemetas',fsids:JSON.stringify([fsId]),dlink:1});
      if(!Array.isArray(d.list)||d.list.length!==1||d.list[0].fs_id!==fsId||d.list[0].errno) fail('文件元数据校验失败');
      return d.list[0];
    }
    async download(remote,settings) {
      const m=await this.meta(remote.fsId);
      if(m.path!==remote.remotePath || m.size!==remote.size || (m.md5 && remote.md5 && m.md5!==remote.md5)) fail('下载前云端文件已变化');
      if(!m.dlink) fail('文件没有下载地址');
      const u=new URL(m.dlink); if(u.protocol!=='https:' || !/(^|\.)(baidu\.com|baidupcs\.com)$/.test(u.hostname)) fail('下载地址不属于百度 HTTPS 服务');
      u.searchParams.set('access_token',await this.oauth.refreshTokenIfNeeded());
      const r=await requestUrl({url:u.toString(),method:'GET',headers:{'User-Agent':'pan.baidu.com'},throw:false});
      if(r.status!==200 || r.arrayBuffer.byteLength!==remote.size) fail('下载失败或文件长度不匹配');
      const raw=r.arrayBuffer;
      if(isEncrypted(raw)) { if(!settings.e2eePassword) fail('缺少解密密码');return decryptData(raw,settings.e2eePassword); }
      return raw;
    }
    async manage(op,items,options={}) {
      const d=await this.request('https://pan.baidu.com/rest/2.0/xpan/file',{method:'filemanager',opera:op},{async:'0',ondup:'fail',filelist:JSON.stringify(items)},{noRetry:true});
      if(d.taskid || d.task_id){if(options.allowTask)return d;fail('文件管理返回异步任务，未确认完成，停止后续操作');}
      if(!Array.isArray(d.info) || d.info.length!==items.length || d.info.some((x,i)=>x.errno!==0 || x.path!==(typeof items[i]==='string'?items[i]:items[i].path))) fail('文件管理未全部成功');
      return d;
    }
    async mkdir(path) {
      const d=await this.request('https://pan.baidu.com/rest/2.0/xpan/file',{method:'create'},{path,size:'0',isdir:'1',rtype:'0'}).catch(async e=>{if(e.errno!==-8)throw e;return null;});
      if(d && (d.path!==path || d.isdir!==1)) fail('创建目录返回路径不匹配');
    }
    async upload(path,buffer,settings,journals,persist,beforeCommit=async()=>{}) {
      if(settings.enableE2EE && !settings.e2eePassword) fail('加密已开启但缺少密码');
      const payload=settings.enableE2EE?await encryptData(buffer,settings.e2eePassword):buffer;
      const size=payload.byteLength, chunk=4*1024*1024, blocks=[];
      for(let i=0;i<Math.max(1,Math.ceil(size/chunk));i++) blocks.push(md5(payload.slice(i*chunk,Math.min(size,(i+1)*chunk))));
      const signature=await hash(payload);const old=journals[path];
      const form={path,size:String(size),isdir:'0',autoinit:'1',rtype:'3',block_list:JSON.stringify(blocks),'content-md5':md5(payload),'slice-md5':md5(payload.slice(0,256*1024))};
      if(old?.hash===signature && Date.now()-old.at<24*3600000) form.uploadid=old.uploadid;
      let pre;
      try { pre=await this.request('https://pan.baidu.com/rest/2.0/xpan/file',{method:'precreate'},form); }
      catch(e) { if(!form.uploadid)throw e;delete form.uploadid;pre=await this.request('https://pan.baidu.com/rest/2.0/xpan/file',{method:'precreate'},form); }
      if(!pre.uploadid || !Array.isArray(pre.block_list)) fail('预上传缺少 uploadid 或分片列表');
      const parts=pre.block_list.length?pre.block_list:[0]; // Official precreate: [] is equivalent to [0].
      if(parts.some(i=>!Number.isInteger(i)||i<0||i>=blocks.length)||new Set(parts).size!==parts.length) fail('预上传分片序号无效');
      journals[path]={hash:signature,uploadid:pre.uploadid,at:Date.now()};await persist();
      const loc=await this.request('https://d.pcs.baidu.com/rest/2.0/pcs/file',{method:'locateupload',appid:250528,path,uploadid:pre.uploadid,upload_version:'2.0'});
      const host=loc.host;
      if(typeof host!=='string'||!/^([a-z0-9-]+\.)*pcs\.baidu\.com$/i.test(host)) fail('上传域名校验失败');
      for(const i of parts) {
        const part=payload.slice(i*chunk,Math.min(size,(i+1)*chunk));const multipart=buildMultipartFormData(part,'file','blob');let ok=false;
        for(let attempt=0;attempt<3;attempt++) {
          const u=new URL(`https://${host}/rest/2.0/pcs/superfile2`);
          for(const [k,v] of Object.entries({method:'upload',type:'tmpfile',path,uploadid:pre.uploadid,partseq:i,access_token:await this.oauth.refreshTokenIfNeeded()})) u.searchParams.set(k,String(v));
          try {const r=await requestUrl({url:u.toString(),method:'POST',headers:{'Content-Type':multipart.contentType,'User-Agent':'pan.baidu.com'},body:multipart.body,throw:false});
            if(r.status===200 && !r.json.errno && !r.json.error_code && r.json.md5===blocks[i]) {ok=true;break;}
            if([110,111,-6].includes(r.json.errno??r.json.error_code)) await this.oauth.refreshTokenIfNeeded(true);
          }catch { ok = false; } await this.pause(1000*2**attempt);
        }
        if(!ok) fail(`分片 ${i} 上传或 MD5 校验失败；保留 uploadid 供重试`);
      }
      await beforeCommit();
      const d=await this.request('https://pan.baidu.com/rest/2.0/xpan/file',{method:'create'},{path,size:String(size),isdir:'0',rtype:'3',uploadid:pre.uploadid,block_list:JSON.stringify(blocks)},{noRetry:true});
      if(d.path!==path || d.size!==size || !Number.isSafeInteger(d.fs_id)) fail('创建文件响应校验失败');
      delete journals[path];await persist();return d;
    }
  }

  function plan(local,remote,baseline,base) {
    const out=[],used=new Set();const entries=Object.entries(baseline);
    // Only unambiguous unchanged-content renames are optimized. Other cases reconcile as add/delete.
    for(const [old,b] of entries) {
      if(!b.local?.hash || !b.remote) continue;
      const l=local.get(old),r=remote.get(old);
      if(!l && r && sameRemote(r,b.remote)) {
        const matches=[...local.values()].filter(x=>x.hash===b.local.hash && !baseline[x.path] && !remote.has(x.path) && !used.has(x.path));
        const baselineMatches=entries.filter(([,v])=>v.local?.hash===b.local.hash);
        if(matches.length===1 && baselineMatches.length===1){const n=matches[0];out.push({action:'MOVE_REMOTE',path:n.path,oldPath:old,local:n,remote:r});used.add(old);used.add(n.path);}
      } else if(l && !r && l.hash===b.local.hash && !old.startsWith('.')) {
        const matches=[...remote.values()].filter(x=>String(x.fsId)===String(b.remote.fsId) && !baseline[x.path] && !local.has(x.path) && !used.has(x.path) && !x.path.startsWith('.'));
        if(matches.length===1 && sameRemote(matches[0],b.remote)) {const n=matches[0];out.push({action:'MOVE_LOCAL',path:n.path,oldPath:old,local:l,remote:n});used.add(old);used.add(n.path);}
      }
    }
    for(const path of new Set([...local.keys(),...remote.keys(),...Object.keys(baseline)])) {
      if(used.has(path))continue;const l=local.get(path),r=remote.get(path),b=baseline[path];let action;
      if(l && r) {
        if(!b?.local?.hash || !b.remote) action='VERIFY';
        else { const lc=l.hash!==b.local.hash,rc=!sameRemote(r,b.remote);
          action=lc&&rc?'CONFLICT':lc?'UPLOAD':rc?'DOWNLOAD':null; }
      } else if(l) action=b?.local?.hash && l.hash===b.local.hash?'DELETE_LOCAL':'UPLOAD';
      else if(r) action=b?.remote && sameRemote(r,b.remote)?'DELETE_REMOTE':'DOWNLOAD';
      else action='FORGET';
      if(action)out.push({action,path,local:l,remote:r});
    }
    return out.map(x=>({...x,remotePath:base+'/'+x.path}));
  }

  class Runner {
    constructor(engine) {
      this.e=engine;this.app=engine.app;this.adapter=this.app.vault.adapter;this.api=new Api(engine.client.oauth);
      const legacyDir=engine.manifest.manifestFilePath.slice(0,engine.manifest.manifestFilePath.lastIndexOf('/'));
      this.stateDir=this.app.vault.configDir+'/baidu-sync/baidu-netdisk-sync-plus';
      this.statePath=this.stateDir+'/native-state.json';this.planPath=this.stateDir+'/native-plan.json';this.renamesPath=this.stateDir+'/native-renames.json';
      this.legacyStatePath=legacyDir+'/native-state.json';this.legacyRenamesPath=legacyDir+'/native-renames.json';
      this.renameQueue=Promise.resolve();this.stopped=false;
    }
    log(level,message){this.e.addLog(level,message);}
    async ensureStateDir(){let current='';for(const part of this.stateDir.split('/')){current=current?current+'/'+part:part;if(!await this.adapter.exists(current))await this.adapter.mkdir(current);}}
    async persist(){await this.ensureStateDir();await this.adapter.write(this.statePath,JSON.stringify(this.state));}
    async load(settings) {
      const u=await this.api.request('https://pan.baidu.com/rest/2.0/xpan/nas',{method:'uinfo'});
      if(!u.uk)fail('无法确认网盘账号，停止同步');
      this.base=basePath(settings.remoteBasePath, validateSyncPath);
      const scope=JSON.stringify([String(u.uk),this.base,settings.appKey,!!settings.enableE2EE]);
      await this.ensureStateDir();
      if(!await this.adapter.exists(this.statePath) && await this.adapter.exists(this.legacyStatePath)) {
        await this.adapter.write(this.statePath,await this.adapter.read(this.legacyStatePath));
        this.log('info','同步记录已迁移到稳定目录，后续插件更新不会重新扫描');
      }
      let state;
      if(await this.adapter.exists(this.statePath)) {try{state=JSON.parse(await this.adapter.read(this.statePath));}catch{fail('本地同步基线损坏，请先恢复 native-state.json');}}
      if(state && state.version!==2)fail('本地同步基线版本不支持');
      if(!state || state.scope!==scope) {state={version:2,scope,adopted:false,files:{},uploads:{}};this.log('info','首次同步：正在核对两端文件');}
      if(!state.files || !state.uploads)fail('本地同步基线不完整');
      for(const [p,b] of Object.entries(state.files)) {relative(this.base+'/'+p,this.base);if(!b.local?.hash||!b.remote||b.remote.remotePath!==this.base+'/'+p)fail('本地同步基线条目无效');}
      this.state=state;this.settings={...settings};this.e.filter.updateSettings(settings);
    }
    ignored(p){const stateRoot=this.app.vault.configDir+'/baidu-sync';return p===stateRoot||p.startsWith(stateRoot+'/')||reserved(p)||this.e.filter.shouldIgnore(p);}
    async localFile(path) {
      relative(this.base+'/'+path,this.base);
      const s=await this.adapter.stat(path);if(!s)return null;if(s.type!=='file')fail('预期文件的位置存在目录：'+path);
      const b=await this.adapter.readBinary(path), after=await this.adapter.stat(path);
      if(!after || s.size!==after.size || s.mtime!==after.mtime || b.byteLength!==s.size)fail('本地文件正在变化：'+path);
      return {path,size:s.size,mtime:s.mtime,hash:await hash(b)};
    }
    async scanLocal() {
      const result=new Map(),seen=new Set();
      const scan=async dir=>{if(seen.has(dir))return;seen.add(dir);const d=await this.adapter.list(dir);
        for(const p of d.files){if(this.ignored(p))continue;const f=await this.localFile(p);if(!f)fail('本地文件在扫描中消失');result.set(p,f);}
        for(const p of d.folders){if(!this.ignored(p))await scan(p);}
      };
      await scan('');if(this.settings.syncObsidianConfig && !seen.has(this.app.vault.configDir) && await this.adapter.exists(this.app.vault.configDir))await scan(this.app.vault.configDir);
      return result;
    }
    async scan() {
      const local=await this.scanLocal();let last=0;
      const all=await this.api.listAll(this.base,p=>{if(p.done || Date.now()-last>3000){this.log('info',p.done?`扫描完成：${p.files} 个文件`:`扫描中：${p.files} 个文件`);last=Date.now();}});
      const remote=new Map([...all].filter(([p])=>!this.ignored(p)));
      // Never treat exclusions as deletions.
      const baseline=Object.fromEntries(Object.entries(this.state.files).filter(([p])=>!this.ignored(p)));
      const windows=Platform.isWin;
      if(windows) {const paths=new Map();for(const p of new Set([...local.keys(),...remote.keys()])) {const key=p.toLowerCase();if(paths.has(key)&&paths.get(key)!==p)fail('Windows 文件名大小写冲突：'+p);paths.set(key,p);
        if(p.split('/').some(x=>/[<>:"|?*]/.test(x)||/[ .]$/.test(x)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(x)))fail('Windows 不支持云端文件名：'+p);}}
      const items=plan(local,remote,baseline,this.base);
      // A changed baseline or cloud revision does not prove the two current
      // versions differ. Compare plaintext before offering conflicts or transfers.
      const needsComparison=x=>x.local&&x.remote&&['VERIFY','UPLOAD','DOWNLOAD','CONFLICT'].includes(x.action);
      let verified=0,total=items.filter(needsComparison).length;
      for(const x of items) {
        if(!needsComparison(x))continue;
        if(this.stopped)fail('插件已卸载，停止核对');
        const downloaded=await this.api.download(x.remote,this.settings);
        await this.checkLocal(x.path,x.local);
        await this.checkRemote(x.path,x.remote);
        if(await hash(downloaded)===x.local.hash)x.action='ADOPT';
        else if(x.action==='VERIFY')x.action='CONFLICT';
        if(++verified%10===0 || verified===total)this.log('info',`内容核对：${verified}/${total}`);
      }
      return items;
    }
    async checkLocal(path,expected) {const now=await this.localFile(path);if((now?.hash||null)!==(expected?.hash||null))fail('本地文件在扫描后变化：'+path);return now;}
    async checkRemote(path,expected) {const now=await this.api.lookup(this.base+'/'+path,this.base);if(!sameRemote(now,expected))fail('云端文件在扫描后变化：'+path);return now;}
    async parents(path,remote=false) {
      const parts=path.split('/');parts.pop();let current=remote?this.base:'';
      for(const part of parts){current=current?current+'/'+part:part;if(remote)await this.api.mkdir(current);else if(!await this.adapter.exists(current))await this.adapter.mkdir(current);}
    }
    async unique(path,kind) {
      const dot=path.lastIndexOf('.'),slash=path.lastIndexOf('/');const stem=dot>slash?path.slice(0,dot):path, ext=dot>slash?path.slice(dot):'';
      for(let i=0;i<10;i++){const p=`${stem} (${kind}-${Date.now()}-${Math.random().toString(36).slice(2,8)})${ext}`;if(!await this.adapter.exists(p)&&!await this.api.lookup(this.base+'/'+p,this.base))return p;}
      fail('无法分配冲突文件名');
    }
    async record(path,l,r){this.state.files[path]={local:l,remote:r};await this.persist();}
    async loadRenames(){
      await this.ensureStateDir();
      if(!await this.adapter.exists(this.renamesPath) && await this.adapter.exists(this.legacyRenamesPath))await this.adapter.write(this.renamesPath,await this.adapter.read(this.legacyRenamesPath));
      if(!await this.adapter.exists(this.renamesPath))return[];
      let d;try{d=JSON.parse(await this.adapter.read(this.renamesPath));}catch{fail('本机重命名记录损坏');}
      if(!d||d.version!==1||!Array.isArray(d.entries))fail('本机重命名记录版本不支持');
      return d.entries.filter(e=>e&&typeof e.oldPath==='string'&&typeof e.newPath==='string'&&e.oldPath!==e.newPath&&(e.kind==='file'||e.kind==='folder'));
    }
    async saveRenames(entries){await this.ensureStateDir();await this.adapter.write(this.renamesPath,JSON.stringify({version:1,entries}));}
    async recordRename(oldPath,newPath,kind){
      this.renameQueue=this.renameQueue.then(()=>this._recordRename(oldPath,newPath,kind),()=>this._recordRename(oldPath,newPath,kind));
      return this.renameQueue;
    }
    async _recordRename(oldPath,newPath,kind){
      if(!oldPath||!newPath||oldPath===newPath||!['file','folder'].includes(kind))return;
      if([oldPath,newPath].some(p=>p.startsWith('.trash/')||p.startsWith('.baidu-native-history/')||p.includes('baidu-netdisk-sync')||p==='native-renames.json'))return;
      let entries=await this.loadRenames();
      entries=entries.filter(x=>!(x.oldPath===oldPath||x.newPath===newPath));
      let merged={oldPath,newPath,kind,at:Date.now()},changed=true;
      while(changed){changed=false;for(const x of entries){if(x.kind!==merged.kind)continue;if(merged.newPath===x.oldPath){merged.newPath=x.newPath;entries=entries.filter(y=>y!==x);changed=true;break;}if(merged.oldPath===x.newPath){merged.oldPath=x.oldPath;entries=entries.filter(y=>y!==x);changed=true;break;}}}
      if(merged.oldPath!==merged.newPath)entries.push(merged);
      const byOld=new Map();for(const x of entries)byOld.set(x.oldPath,x);
      await this.saveRenames([...byOld.values()]);
    }
    async waitRemoteRename(oldRemotePath,newRemotePath,attempts=30){
      for(let i=0;i<attempts;i++){
        const a=await this.api.lookup(oldRemotePath,this.base),b=await this.api.lookup(newRemotePath,this.base);
        if(!a&&b)return b;
        if(a&&b)fail('云端重命名后新旧路径同时存在');
        await new Promise(r=>schedule(r,1000));
      }
      fail('云端文件夹重命名尚未完成，保留记录待重试');
    }
    async rebaseAfterRename(e,moved){
      if(e.kind==='file'){
        const b=this.state.files[e.oldPath];delete this.state.files[e.oldPath];
        if(b){this.state.files[e.newPath]={local:{...b.local,path:e.newPath},remote:{...moved,path:e.newPath,remotePath:this.base+'/'+e.newPath}};await this.persist();return;}
        if(this.state.files[e.newPath])return;
        const lf=await this.localFile(e.newPath);if(!lf)return;const bytes=await this.adapter.readBinary(e.newPath);await this.put(e.newPath,bytes,lf,moved);return;
      }
      const oldPrefix=e.oldPath.replace(/\/$/,''),newPrefix=e.newPath.replace(/\/$/,'');const movedKeys=[];let actual=new Map();
      try{actual=await this.api.listAll(this.base+'/'+newPrefix);}catch(err){this.log('warn','文件夹改名后读取新目录元数据失败，将使用旧时间戳：'+safeError(err));}
      for(const key of Object.keys(this.state.files)){
        if(!key.startsWith(oldPrefix+'/'))continue;
        const newKey=newPrefix+key.slice(oldPrefix.length);const b=this.state.files[key];
        const fresh=actual.get(newKey.slice(newPrefix.length+1))||b.remote;
        delete this.state.files[key];this.state.files[newKey]={local:{...b.local,path:newKey},remote:{...fresh,path:newKey,remotePath:this.base+'/'+newKey}};movedKeys.push(newKey);
      }
      await this.persist();
      if(movedKeys.length)this.log('info',`已迁移 ${movedKeys.length} 个文件的重命名基线`);
    }
    async applyRename(e){
      const oldLocal=await this.adapter.exists(e.oldPath),newLocal=await this.adapter.exists(e.newPath);
      if(!oldLocal&&!newLocal){this.log('warn','本地旧路径和新路径都不存在，丢弃重命名记录：'+e.oldPath);return false;}
      if(oldLocal)fail('本地旧路径仍然存在，不能确认重命名：'+e.oldPath);
      const oldRemote=await this.api.lookup(this.base+'/'+e.oldPath,this.base),newRemote=await this.api.lookup(this.base+'/'+e.newPath,this.base);
      if(oldRemote&&newRemote)fail('云端新旧路径同时存在：'+e.oldPath);
      if(!oldRemote&&newRemote){await this.rebaseAfterRename(e,newRemote);return;}
      if(!oldRemote){
        const tracked=!!this.state?.files && (e.kind==='folder'
          ?Object.keys(this.state.files).some(p=>p.startsWith(e.oldPath.replace(/\/$/,'')+'/'))
          :!!this.state.files[e.oldPath]);
        if(tracked)fail('云端旧路径不存在，但本机同步基线仍记录它曾同步；请先确认云端文件是否被其他设备移走：'+e.oldPath);
        this.log('warn','云端没有旧路径，按新建文件处理：'+e.oldPath+' → '+e.newPath);
        return false;
      }
      if(e.kind==='folder'&&oldRemote.isdir!==1)fail('云端旧路径不是文件夹：'+e.oldPath);
      if(e.kind==='file'&&oldRemote.isdir!==0)fail('云端旧路径不是文件：'+e.oldPath);
      const oldParent=e.oldPath.lastIndexOf('/')>0?e.oldPath.slice(0,e.oldPath.lastIndexOf('/')):'';
      const newParent=e.newPath.lastIndexOf('/')>0?e.newPath.slice(0,e.newPath.lastIndexOf('/')):'';
      const newName=e.newPath.split('/').pop();
      const d=oldParent===newParent
        ?await this.api.manage('rename',[{path:oldRemote.remotePath,newname:newName}],{allowTask:e.kind==='folder'})
        :await this.api.manage('move',[{path:oldRemote.remotePath,dest:this.base+(newParent?'/'+newParent:''),newname:newName,ondup:'fail'}],{allowTask:e.kind==='folder'});
      let moved;
      if(d.taskid||d.task_id)moved=await this.waitRemoteRename(oldRemote.remotePath,this.base+'/'+e.newPath,e.kind==='folder'?60:10);
      else moved=await this.api.lookup(this.base+'/'+e.newPath,this.base);
      if(!moved)fail('云端重命名后新路径不存在：'+e.newPath);
      if(e.kind==='file'&&moved.fsId!==oldRemote.fsId)fail('云端重命名后 fs_id 变化');
      await this.rebaseAfterRename(e,moved);
    }
    async applyRenames(){
      await this.renameQueue;const entries=await this.loadRenames();if(!entries.length)return;
      entries.sort((a,b)=>(a.kind==='folder'?0:1)-(b.kind==='folder'?0:1)||a.oldPath.length-b.oldPath.length);
      const remaining=[],renamedFolders=[];
      for(const e of entries){
        if(renamedFolders.some(f=>e.oldPath.startsWith(f.oldPath+'/')&&e.newPath===f.newPath+e.oldPath.slice(f.oldPath.length))){this.log('info','文件夹重命名已覆盖：'+e.oldPath);continue;}
        try{const applied=await this.applyRename(e);if(applied===false)continue;this.log('success','云端重命名：'+e.oldPath+' → '+e.newPath);if(e.kind==='folder')renamedFolders.push(e);}
        catch(err){remaining.push(e);this.log('error','重命名待处理：'+e.oldPath+' → '+e.newPath+'：'+safeError(err));}
      }
      await this.saveRenames(remaining);
      if(remaining.length)fail(`有 ${remaining.length} 个重命名待处理，已停止本次同步`);
    }
    async put(path,buffer,expectedLocal,expectedRemote) {
      await this.checkLocal(path,expectedLocal);await this.parents(path,true);await this.checkRemote(path,expectedRemote);
      await this.api.upload(this.base+'/'+path,buffer,this.settings,this.state.uploads,()=>this.persist(),async()=>{await this.checkLocal(path,expectedLocal);await this.checkRemote(path,expectedRemote);});
      const r=await this.api.lookup(this.base+'/'+path,this.base);if(!r)fail('上传后文件不存在');
      // Opaque cloud MD5 cannot validate local bytes. Verify by native download + plaintext SHA-256.
      const verified=await this.api.download(r,this.settings);
      if(await hash(verified)!==await hash(buffer))fail('上传后内容校验失败');
      await this.checkLocal(path,expectedLocal);await this.checkRemote(path,r);
      await this.record(path,await this.localFile(path),r);
    }
    async execute(x) {
      if(this.stopped)fail('插件已卸载，停止同步');
      if(x.action==='FORGET'){delete this.state.files[x.path];await this.persist();return;}
      const localPath=x.action==='MOVE_LOCAL'?x.oldPath:x.path;
      const remotePath=x.action==='MOVE_REMOTE'?x.oldPath:x.path;
      await this.checkLocal(localPath,x.local);await this.checkRemote(remotePath,x.remote);
      if(x.action==='ADOPT'){await this.record(x.path,x.local,x.remote);return;}
      if(x.action==='MOVE_LOCAL') {
        await this.checkLocal(x.path,null);await this.parents(x.path);
        const f=this.app.vault.getAbstractFileByPath(x.oldPath);if(!f)fail('Obsidian 尚未加载待移动文件');
        await this.app.fileManager.renameFile(f,x.path);delete this.state.files[x.oldPath];
        // Obsidian may rewrite self-links during rename. Keep the pre-rename content hash so the next run uploads that rewrite.
        await this.record(x.path,{...x.local,path:x.path},x.remote);return;
      }
      if(x.action==='MOVE_REMOTE') {
        await this.parents(x.path,true);await this.checkRemote(x.path,null);
        await this.api.manage('move',[{path:x.remote.remotePath,dest:x.remotePath.slice(0,x.remotePath.lastIndexOf('/')),newname:x.path.split('/').pop(),ondup:'fail'}]);
        const r=await this.api.lookup(x.remotePath,this.base);if(!r || r.fsId!==x.remote.fsId)fail('云端移动后 fs_id 不匹配');
        delete this.state.files[x.oldPath];await this.record(x.path,x.local,r);return;
      }
      if(x.action==='DELETE_LOCAL') {
        const f=this.app.vault.getAbstractFileByPath(x.path);
        if(f)await this.app.fileManager.trashFile(f);else if(!await this.adapter.trashLocal(x.path))fail('无法将文件移入本地回收站');
        delete this.state.files[x.path];await this.persist();return;
      }
      if(x.action==='DELETE_REMOTE'){await this.api.manage('delete',[x.remotePath]);delete this.state.files[x.path];await this.persist();return;}
      if(x.action==='UPLOAD') {const b=await this.adapter.readBinary(x.path);if(await hash(b)!==x.local.hash)fail('上传前本地文件变化');await this.put(x.path,b,x.local,x.remote);return;}
      const bytes=await this.api.download(x.remote,this.settings),h=await hash(bytes);
      await this.checkLocal(x.path,x.local);await this.checkRemote(x.path,x.remote);
      if(x.local?.hash===h){await this.record(x.path,x.local,x.remote);return;}
      if(x.local && (x.action==='CONFLICT'||x.action==='VERIFY')) {
        // Keep user's local file; save remote version under a unique name. Both become visible notes.
        const conflict=await this.unique(x.path,'remote-conflict');await this.parents(conflict);await this.adapter.writeBinary(conflict,bytes);
        const c=await this.localFile(conflict);await this.put(conflict,bytes,c,null);
        const original=await this.adapter.readBinary(x.path);if(await hash(original)!==x.local.hash)fail('保留冲突后本地原文已变化');
        await this.put(x.path,original,x.local,x.remote);this.log('warn','两端修改均已保留：'+conflict);return;
      }
      await this.parents(x.path);await this.checkLocal(x.path,x.local);await this.checkRemote(x.path,x.remote);
      await this.adapter.writeBinary(x.path,bytes);const written=await this.localFile(x.path);
      if(written.hash!==h)fail('写入后内容校验失败');await this.record(x.path,written,x.remote);
    }
    chooseConflicts(conflicts) {
      return new Promise(resolve => {
        let settled=false;
        const RunnerModal=class extends Modal {
          onOpen(){
            const {contentEl}=this;contentEl.empty();
            contentEl.createEl('h2',{text:'发现同步冲突'});
            contentEl.createEl('p',{text:'请逐项选择。保留双方会生成一个 remote-conflict 副本；保留本地会覆盖云端；保留云端会覆盖本地。'});
            const scroll=contentEl.createDiv({cls:'baidu-conflict-scroll'});
            const table=scroll.createEl('table',{cls:'baidu-conflict-table'});
            const head=table.createEl('thead').createEl('tr');
            for(const text of ['文件','本地大小','云端大小','处理'])head.createEl('th',{text});
            const body=table.createEl('tbody');const selects=[];
            for(const item of conflicts){
              const row=body.createEl('tr');
              row.createEl('td',{text:item.path,cls:'baidu-conflict-path'});
              row.createEl('td',{text:item.local?`${item.local.size} B`:'—'});
              row.createEl('td',{text:item.remote?`${item.remote.size} B`:'—'});
              const cell=row.createEl('td');const select=cell.createEl('select',{cls:'dropdown'});
              for(const [value,label] of Object.entries(conflictChoices)){const option=select.createEl('option',{text:label});option.value=value;}
              select.value='both';selects.push(select);
            }
            const buttons=contentEl.createDiv({cls:'modal-button-container'});
            buttons.createEl('button',{text:'取消'}).onclick=()=>{settled=true;this.close();resolve(null);};
            buttons.createEl('button',{text:'应用选择',cls:'mod-cta'}).onclick=()=>{settled=true;const choices=conflicts.map((item,index)=>({item,choice:selects[index].value}));this.close();resolve(choices);};
          }
          onClose(){if(!settled){settled=true;resolve(null);}this.contentEl.empty();}
        };
        new RunnerModal(this.app).open();
      });
    }
    async run({preview=false,confirm=false,silent=false,trigger=''}={}) {
      const e=this.e;if(this.stopped)return {success:false,stopped:true};if(e.isSyncing())return {success:false,busy:true};
      e.setState('preparing','同步准备');const stats={uploaded:0,downloaded:0,deleted:0,adopted:0,errors:0,pending:0,conflicts:0};
      try {
        await this.load(e.getSettings());this.runId=Date.now()+'-'+Math.random().toString(36).slice(2,8);
        this.log('info','同步目录：'+this.base);
        const previewOnly=preview||(silent&&!this.state.adopted);
        if(previewOnly){const pending=await this.loadRenames();if(pending.length)this.log('info',`待处理重命名 ${pending.length} 项；预览不执行`);}
        else await this.applyRenames();
        e.setState('diffing','读取本地内容与网盘文件列表');let items=await this.scan();
        await this.adapter.write(this.planPath,JSON.stringify({at:new Date().toISOString(),base:this.base,firstRun:!this.state.adopted,items},null,2));
        const counts={},summaryCounts={};for(const x of items){counts[x.action]=(counts[x.action]||0)+1;const label=itemLabel(x);summaryCounts[label]=(summaryCounts[label]||0)+1;}
        this.log('info','同步计划：'+(Object.entries(summaryCounts).map(([label,n])=>`${label} ${n} 项`).join('，')||'无变化'));
        if(previewOnly){this.log('info',this.state.adopted?'预览已保存；未修改任何文件':'预览完成，请确认同步目录后开始同步');e.setState('idle','预览完成');return {success:true,preview:true,counts,items};}
        const conflicts=items.filter(x=>x.action==='CONFLICT');const promptConflicts=!silent||String(trigger).includes('启动');
        if(conflicts.length){
          if(!promptConflicts){stats.conflicts=conflicts.length;items=items.filter(x=>x.action!=='CONFLICT');this.log('warn',`发现 ${stats.conflicts} 个冲突，后台自动同步暂不处理；请手动同步后选择`);}
          else {
            const choices=await this.chooseConflicts(conflicts);
            if(!choices){e.setState('idle','已取消');return {success:false,cancelled:true};}
            for(const {item,choice} of choices){
              if(choice==='local')item.action='UPLOAD';
              else if(choice==='remote')item.action='DOWNLOAD';
              else if(choice==='skip'){stats.conflicts++;items=items.filter(x=>x!==item);this.log('warn','已跳过冲突：'+item.path);}
            }
          }
        }
        if(!items.length){
          if(stats.conflicts){this.log('warn',`同步完成：${stats.conflicts} 项冲突待处理`);e.setState('idle',`${stats.conflicts} 项冲突待处理`);return {success:false,stats,counts};}
          this.state.adopted=true;this.state.lastSync=Date.now();await this.persist();
          this.log('success','同步完成：两端已一致，无需传输');e.setState('idle','同步完成（无变化）');return {success:true,stats,counts};
        }
        const firstTransfers=!this.state.adopted&&items.some(x=>!['ADOPT','FORGET'].includes(x.action));
        if(confirm && (firstTransfers||items.some(x=>x.action.startsWith('DELETE_'))) && !await this.confirm(items)){e.setState('idle','已取消');return {success:false,cancelled:true};}
        e.setState('syncing','执行双向同步');
        const adopted=items.filter(x=>x.action==='ADOPT');
        if(adopted.length){for(const x of adopted)this.state.files[x.path]={local:x.local,remote:x.remote};await this.persist();stats.adopted=adopted.length;this.log('info',`内容一致：${stats.adopted} 项，已建立同步记录`);}
        for(const x of items){
          if(x.action==='ADOPT')continue;
          if(x.action.startsWith('DELETE_') && !confirm){stats.pending++;this.log('warn','删除待手动确认：'+x.path);continue;}
          try {await this.execute(x);this.log('success',itemLabel(x)+'：'+x.path);if(x.action==='UPLOAD')stats.uploaded++;else if(x.action==='DOWNLOAD')stats.downloaded++;else if(x.action.startsWith('DELETE_'))stats.deleted++;}
          catch(err){stats.errors++;this.log('error',x.path+'：'+safeError(err));break;}
        }
        if(!stats.errors){this.state.adopted=true;this.state.lastSync=Date.now();await this.persist();}
        const conflictText=stats.conflicts?`，${stats.conflicts} 项冲突待处理`:'';
        const adoptedText=stats.adopted?`一致 ${stats.adopted}，`:'';
        const summary=stats.errors?`同步中断：成功项目已保存，失败 ${stats.errors} 项`:stats.pending?`同步完成：${stats.pending} 项删除待确认${conflictText}`:`同步完成：${adoptedText}上传 ${stats.uploaded}，下载 ${stats.downloaded}，删除 ${stats.deleted}${conflictText}`;
        this.log(stats.errors?'error':stats.pending?'warn':'success',summary);
        e.setState(stats.errors?'error':'idle',stats.errors?'同步中断，成功项目已保存':stats.pending?`${stats.pending} 项删除待审阅`:(stats.conflicts?`${stats.conflicts} 项冲突待处理`:'同步完成'));
        return {success:stats.errors===0 && stats.pending===0 && stats.conflicts===0,stats};
      }catch(err){this.log('error',safeError(err));e.setState('error',safeError(err));return {success:false,error:safeError(err),stats:{...stats,errors:stats.errors+1}};}
    }
    confirm(items) {
      const target=this.base;
      return new Promise(resolve=>{
        let accepted=false;
        class Review extends Modal {
          onOpen(){this.contentEl.createEl('h2',{text:'审阅本次同步'});this.contentEl.createEl('p',{text:'同步目录：'+target});this.contentEl.createEl('p',{text:'请确认目录和下列操作。内容一致的文件只建立同步记录；删除项移入回收站。'});
            const box=this.contentEl.createDiv({cls:'baidu-conflict-scroll'});
            for(const x of items)box.createEl('p',{text:`${itemLabel(x)}  ${x.oldPath?x.oldPath+' → ':''}${x.path}`});
            new Setting(this.contentEl).addButton(b=>b.setButtonText('取消').onClick(()=>this.close())).addButton(b=>b.setButtonText('确认这些操作并同步').setCta().onClick(()=>{accepted=true;this.close();}));}
          onClose(){this.contentEl.empty();resolve(accepted);}
        }
        new Review(this.app).open();
      });
    }
  }

  function install({SyncEngine,BaiduSyncPlugin,SyncLogModal,SyncFilter,TFile}) {
    const originalFilter=SyncFilter.prototype.shouldIgnore;
    SyncFilter.prototype.shouldIgnore=function(p){return reserved(p)||originalFilter.call(this,p);};
    SyncEngine.prototype.nativeRunner=function(){return this._nativeRunner||(this._nativeRunner=new Runner(this));};
    SyncEngine.prototype.startSync=function(silent=false,trigger=''){if(this.onSetupRequired?.())return Promise.resolve({success:false,setupRequired:true});if(trigger==='启动自动'){const now=Date.now();if(this._lastStartupSync&&now-this._lastStartupSync<15000)return Promise.resolve({success:false,duplicate:true});this._lastStartupSync=now;}return this.nativeRunner().run({silent,confirm:!silent,trigger});};
    SyncEngine.prototype.previewNative=function(){if(this.onSetupRequired?.())return Promise.resolve({success:false,setupRequired:true});return this.nativeRunner().run({preview:true});};
    // Prevent inherited legacy entry points from writing or reading the shared index.
    SyncEngine.prototype.writeRemoteIndex=async function(){throw new Error('当前版本不使用共享索引');};
    SyncEngine.prototype.loadRemoteIndex=async function(){throw new Error('当前版本不读取共享索引');};
    SyncEngine.prototype.convertVaultToPlaintext=async function(){throw new Error('请先完成同步，再单独规划加密迁移；本版本不执行旧版全量覆盖迁移');};
    SyncEngine.prototype.recordRename=function(oldPath,newPath,kind){return this.nativeRunner().recordRename(oldPath,newPath,kind);};
    const oldLoad=BaiduSyncPlugin.prototype.onload,oldUnload=BaiduSyncPlugin.prototype.onunload;
    BaiduSyncPlugin.prototype.onload=async function(){await oldLoad.call(this);this.addCommand({id:'baidu-native-preview',name:'预览双向同步（不修改两端文件）',callback:()=>this.engine.previewNative()});this.registerEvent(this.app.vault.on('rename',async(file,oldPath)=>{const kind=file instanceof TFile?'file':'folder';try{await this.engine.recordRename(oldPath,file.path,kind);}catch(err){console.warn('[BaiduSync] 记录本机重命名失败',err);return;}if(this.settings.syncOnSave&&!this.engine.isSyncing()){if(this.renameSyncTimer)window.clearTimeout(this.renameSyncTimer);this.renameSyncTimer=window.setTimeout(()=>{this.renameSyncTimer=null;if(!this.engine.isSyncing())this.engine.startSync(true);},800);}}));};
    BaiduSyncPlugin.prototype.onunload=function(){if(this.renameSyncTimer)window.clearTimeout(this.renameSyncTimer);if(this.engine?._nativeRunner)this.engine._nativeRunner.stopped=true;oldUnload.call(this);};
  }
  return {Api,Runner,plan,hash,stamp,sameRemote,normalize,relative,basePath,reserved,install};
}
if(typeof module!=='undefined') module.exports={createNativeSync};
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- Re-enable the rules after the untyped Baidu transport boundary. */
