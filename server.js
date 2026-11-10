// Mzansi Beats - zero-dependency Node.js server (raw http, JSON file persistence)
const https=require('https');const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),zlib=require('zlib');
const {resolveVideoDirectory,directoryStatus}=require('./video-folder');
const PORT=Number(process.env.PORT||3000), HOST=process.env.HOST||'0.0.0.0',ROOT=__dirname,DATA=path.join(ROOT,'data'),UP=path.join(DATA,'uploads'),COMMUNITY=path.join(DATA,'community-videos'),DBF=path.join(DATA,'db.json');
fs.mkdirSync(UP,{recursive:true});
fs.mkdirSync(COMMUNITY,{recursive:true});
const optimizer=require('./media-optimizer')(ROOT);
for(const n of fs.readdirSync(COMMUNITY))if(/\.partial\.mp4$/.test(n))try{fs.unlinkSync(path.join(COMMUNITY,n))}catch(e){}
const GENRES=['Amapiano','Maskandi','Gqom','Kwaito','Hip Hop','Gospel','House','Afro Pop'];
const PROVS=['Gauteng','KwaZulu-Natal','Western Cape','Eastern Cape','Limpopo','Mpumalanga','North West','Free State','Northern Cape'];
let db={users:[],tracks:[],comments:[],playlists:[],follows:[],likes:[],plays:[],sessions:{},notifs:[],clikes:[],purchases:[],payments:[],communityVideos:[],videoLikes:[],videoComments:[],savedVideos:[],videoReports:[],hiddenHostVideos:[],videoViews:[],videoSounds:[]};
const KEY=process.env.PAYSTACK_SECRET||'',DEMO=process.env.DEMO_PAYMENTS==='1',FEE=0.10,DL={};
try{db=Object.assign(db,JSON.parse(fs.readFileSync(DBF,'utf8')))}catch(e){}
for(const key of ['communityVideos','videoLikes','videoComments','savedVideos','videoReports','hiddenHostVideos','videoViews','videoSounds'])if(!Array.isArray(db[key]))db[key]=[];
const store=require('./db-snapshot')(DBF,()=>db);const save=()=>store.save();
const id=()=>crypto.randomBytes(6).toString('hex');
const hash=(p,s)=>crypto.scryptSync(p,s,32).toString('hex');
const J=(r,c,o)=>{const raw=Buffer.from(JSON.stringify(o));const accepts=String(r.req&&r.req.headers['accept-encoding']||'');
 const compress=raw.length>1200&&/\bgzip\b/.test(accepts);const output=compress?zlib.gzipSync(raw):raw;
 r.writeHead(c,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Accept-Encoding',...(compress?{'Content-Encoding':'gzip'}:{})});r.end(output)};
const staticGzip=new Map();
const limits=new Map();let rateAccess=0;
function limited(req,route){
 const cfg=({'POST /api/login':[30,60000],'POST /api/register':[8,3600000],
  'POST /api/community-video':[20,3600000],'POST /api/video-report':[30,3600000],
  'POST /api/video-comment':[40,60000],'POST /api/video-view':[120,3600000],'POST /api/video-sound':[30,3600000],'POST /api/avatar':[20,3600000]})[route];
 if(!cfg)return false;
 const remote=req.socket.remoteAddress||'unknown',useProxy=process.env.TRUST_PROXY==='1'&&/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(remote);
 const claimed=useProxy?String(req.headers['cf-connecting-ip']||'').slice(0,48):'';
 const ip=/^[a-fA-F0-9.:]+$/.test(claimed)?claimed:remote;
 const key=route+'|'+ip,now=Date.now(),item=limits.get(key);
 if((++rateAccess)%500===0)for(const [k,v] of limits)if(v.until<now)limits.delete(k);
 if(!item||item.until<=now){limits.set(key,{count:1,until:now+cfg[1]});return false}
 item.count++;return item.count>cfg[0];
}
const body=req=>new Promise(res=>{let b='';req.on('data',d=>{b+=d;if(b.length>1e6)req.destroy()});req.on('end',()=>{try{res(JSON.parse(b||'{}'))}catch(e){res({})}})});
const authUser=req=>{const k=(req.headers.authorization||'').replace('Bearer ','');const s=db.sessions[k];return s&&db.users.find(u=>u.id===s)};
const pub=u=>u&&{id:u.id,name:u.name,role:u.role,artist:u.artist,bio:u.bio,province:u.province,lang:u.lang,monetize:u.monetize,price:u.price,verified:!!u.verified,avatar:u.avatar||''};
// ranking: recency-decayed plays+likes
const score=x=>{const age=(Date.now()-x.created)/864e5;return (x.plays+x.likes*3)/Math.pow(age+2,.6)};
const dec=x=>{const a=db.users.find(u=>u.id===x.artistId);return Object.assign({},x,{artist:a?a.artist||a.name:'Unknown',liked:0,tip:!!(a&&a.monetize)})};

function notify(to,type,from,t,text){const tt=t||'';if(!to||to===from)return;if((type==='like'||type==='follow'||type==='clike'||type==='vlike')&&db.notifs.some(n=>n.to===to&&n.type===type&&n.from===from&&n.t===tt))return;db.notifs.push({id:id(),to,type,from,t:tt,text:text||'',d:Date.now(),read:0});if(db.notifs.length>3000)db.notifs.splice(0,500)}
const ps=(method,p,data)=>new Promise((res,rej)=>{const b=data?JSON.stringify(data):null,rq=https.request({host:'api.paystack.co',path:p,method,headers:{Authorization:'Bearer '+KEY,'Content-Type':'application/json',...(b?{'Content-Length':Buffer.byteLength(b)}:{})}},rs=>{let o='';rs.on('data',d=>o+=d);rs.on('end',()=>{try{res(JSON.parse(o))}catch(e){rej(e)}})});rq.on('error',rej);rq.setTimeout(15000,()=>rq.destroy(new Error('timeout')));if(b)rq.write(b);rq.end()});
async function settle(ref){const p=db.payments.find(x=>x.ref===ref);if(!p)return null;if(p.status==='paid')return p;
 if(!DEMO){try{const v=await ps('GET','/transaction/verify/'+encodeURIComponent(ref)),d=v&&v.data;if(!d||d.status!=='success'||d.currency!=='ZAR'||d.amount!==Math.round(p.amount*100))return p}catch(e){return p}}
 if(p.status==='paid')return p;p.status='paid';p.paidAt=Date.now();if(p.kind==='purchase')db.purchases.push({u:p.u,t:p.t,ref});
 notify(p.artistId,p.kind==='tip'?'tip':'sale',p.u,p.t,'R'+p.amount.toFixed(2));save();return p}
const sendTracks=(u,list)=>list.map(x=>{const o=dec(x);o.liked=u&&db.likes.some(l=>l.u===u.id&&l.t===x.id)?1:0;return o});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav','.ogg':'audio/ogg','.mp4':'video/mp4','.webm':'video/webm','.ogv':'video/ogg','.mov':'video/quicktime','.m4v':'video/mp4','.mkv':'video/x-matroska','.avi':'video/x-msvideo','.wmv':'video/x-ms-wmv','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json'};
function serve(req,res,file,extra={}){
 fs.stat(file,(err,st)=>{
  if(err||!st.isFile())return J(res,404,{error:'Video not found'});
  const type=mime[path.extname(file).toLowerCase()]||'application/octet-stream';
  const headers={...extra,'Content-Type':type,'Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff','Cache-Control':extra['Cache-Control']||'public,max-age=60'};
  if(!req.headers.range&&st.size<1024*1024&&/\.(js|css|html|svg|webmanifest)$/.test(file)&&/\bgzip\b/.test(String(req.headers['accept-encoding']||''))){
   const key=file+':'+st.mtimeMs;let compressed=staticGzip.get(key);
   if(!compressed){try{compressed=zlib.gzipSync(fs.readFileSync(file));if(staticGzip.size>25)staticGzip.clear();staticGzip.set(key,compressed)}catch(e){compressed=null}}
   if(compressed){res.writeHead(200,{...headers,'Vary':'Accept-Encoding','Content-Encoding':'gzip','Content-Length':compressed.length});return res.end(req.method==='HEAD'?undefined:compressed)}
  }
  if(req.headers.range){
   const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range.trim());
   if(!m||(m[1]===''&&m[2]==='')){res.writeHead(416,{...headers,'Content-Range':`bytes */${st.size}`});return res.end();}
   let from=m[1]===''?Math.max(0,st.size-Number(m[2])):Number(m[1]);
   let to=m[2]===''||m[1]===''?st.size-1:Number(m[2]);
   if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<from||from>=st.size){res.writeHead(416,{...headers,'Content-Range':`bytes */${st.size}`});return res.end();}
   to=Math.min(to,st.size-1);
   res.writeHead(206,{...headers,'Content-Range':`bytes ${from}-${to}/${st.size}`,'Content-Length':to-from+1});
   if(req.method==='HEAD')return res.end();
   const stream=fs.createReadStream(file,{start:from,end:to});stream.on('error',()=>res.destroy());stream.pipe(res);
  }else{
   res.writeHead(200,{...headers,'Content-Length':st.size});if(req.method==='HEAD')return res.end();
   const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);
  }
 });
}
// PC HOST LIBRARY. Videos in VIDEO_DIR (including subfolders to 3 levels)
// are deliberately PUBLIC to everyone who can access this server.
// Do not put private videos in this folder.
const videoLocation=resolveVideoDirectory(ROOT);
const VIDEO_DIR=videoLocation.dir;
const VIDEO_EXT=new Set(['.mp4','.webm','.m4v','.mov','.ogv','.mkv','.avi','.wmv']);
let localVideoCache={at:0,videos:[],files:new Map()};
function localVideos(){
 if(Date.now()-localVideoCache.at<15000)return localVideoCache;
 const files=new Map(),videos=[];
 if(directoryStatus(VIDEO_DIR).available){
  const pending=[{dir:VIDEO_DIR,rel:'',depth:0}];
  while(pending.length&&videos.length<600){
   const {dir,rel,depth}=pending.shift();let items=[];
   try{items=fs.readdirSync(dir,{withFileTypes:true})}catch(e){continue}
   for(const item of items){
    if(item.name.startsWith('.'))continue;
    const relative=path.join(rel,item.name),full=path.join(dir,item.name);
    if(item.isDirectory()){if(depth<3)pending.push({dir:full,rel:relative,depth:depth+1});continue}
    // Don't follow symlinks or other unusual file types outside the library.
    if(!item.isFile()||!VIDEO_EXT.has(path.extname(item.name).toLowerCase()))continue;
    let st;try{st=fs.statSync(full)}catch(e){continue}
    const vid=crypto.createHash('sha256').update(relative).digest('hex').slice(0,32);
    files.set(vid,full);
    videos.push({id:vid,name:path.basename(item.name,path.extname(item.name)),filename:item.name,
      folder:rel?rel.split(path.sep).join(' / '):'Videos',size:st.size,modified:st.mtimeMs,
      ext:path.extname(item.name).toLowerCase()});
    if(videos.length>=600)break;
   }
  }
 }
 videos.sort((a,b)=>b.modified-a.modified||a.name.localeCompare(b.name));
 localVideoCache={at:Date.now(),videos,files};return localVideoCache;
}
// Stable public IDs are namespaced by source, so saved interactions survive reloads.
const socialKey=(v)=>v.source+':'+v.id;
function resolvePublicVideo(key){
 if(typeof key!=='string'||key.length>100)return null;
 const k=key.indexOf(':');if(k<1)return null;
 const source=key.slice(0,k),token=key.slice(k+1);
 if(source==='host'&&/^[a-f0-9]{32}$/.test(token)){
  const v=!db.hiddenHostVideos.includes(token)&&localVideos().videos.find(x=>x.id===token);
  return v?{id:v.id,key,source,title:v.name,creator:'Mzansi Beats',created:v.modified,src:'/api/host-video/'+v.id}:null;
 }
 if(source==='community'&&/^[a-f0-9]{12}$/.test(token)){
  const v=db.communityVideos.find(x=>x.id===token&&!x.hidden);
  return v?{id:v.id,key,source,title:v.title,creator:v.creator,creatorId:v.ownerId,created:v.created,src:'/api/community-video/'+v.id}:null;
 }
 if(source==='artist'&&/^[a-f0-9]{12}$/.test(token)){
  const v=db.tracks.find(x=>x.id===token&&!x.hidden&&x.kind==='video');
  const a=v&&db.users.find(x=>x.id===v.artistId);
  return v?{id:v.id,key,source,title:v.title,creator:a?(a.artist||a.name):'Artist',creatorId:v.artistId,created:v.created,src:'/media/'+encodeURIComponent(v.media)}:null;
 }
 return null;
}
function decorateVideo(v,u){const key=socialKey(v);const sound=db.videoSounds.find(x=>x.key===key),track=sound&&db.tracks.find(t=>t.id===sound.trackId&&!t.hidden&&t.kind==='audio');return {...v,key,linkedSound:track?{id:track.id,title:track.title,artist:dec(track).artist}:null,views:db.videoViews.filter(x=>x.key===key).length,thumbnail:'/api/video-thumbnail/'+v.source+'/'+v.id,likes:db.videoLikes.filter(x=>x.key===key).length,comments:db.videoComments.filter(x=>x.key===key&&!x.hidden).length,
 liked:!!(u&&db.videoLikes.some(x=>x.key===key&&x.u===u.id)),saved:!!(u&&db.savedVideos.some(x=>x.key===key&&x.u===u.id))};}
function getPublicVideos(){
 const library=localVideos();
 const host=library.videos.filter(v=>!db.hiddenHostVideos.includes(v.id)).map(v=>({id:v.id,title:v.name,creator:'Mzansi Beats',source:'host',created:v.modified,size:v.size,src:'/api/host-video/'+v.id}));
 const community=db.communityVideos.filter(v=>!v.hidden).map(v=>({id:v.id,title:v.title,creator:v.creator,source:'community',province:v.province||'',created:v.created,size:v.size,src:'/api/community-video/'+v.id,ownerId:v.ownerId,creatorId:v.ownerId}));
 const artists=db.tracks.filter(v=>!v.hidden&&v.kind==='video').map(v=>({id:v.id,title:v.title,creator:(db.users.find(u=>u.id===v.artistId)||{}).artist||(db.users.find(u=>u.id===v.artistId)||{}).name||'Artist',source:'artist',province:v.province||'',created:v.created,src:'/media/'+encodeURIComponent(v.media),creatorId:v.artistId}));
 return [...host,...community,...artists].sort((a,b)=>b.created-a.created).slice(0,700);
}
function publicFeed(req,res,u){
 const dirStatus=directoryStatus(VIDEO_DIR);
 const all=getPublicVideos();
 J(res,200,{hostAvailable:dirStatus.available,hostStatus:dirStatus.status,hostOS:process.platform==='win32'?'Windows':'non-Windows',hostCount:all.filter(x=>x.source==='host').length,communityCount:all.filter(x=>x.source!=='host').length,videos:all.map(v=>decorateVideo(v,u))});
}

function publicVideoRoute(req,res,url){
 const host=url.pathname.startsWith('/api/host-video/');const token=url.pathname.split('/').pop();
 if(host){if(!/^[a-f0-9]{32}$/.test(token)||db.hiddenHostVideos.includes(token))return J(res,404,{error:'Not found'});
  let file=localVideos().files.get(token);
  if(!file){localVideoCache.at=0;file=localVideos().files.get(token)}
  return file?serve(req,res,file):J(res,404,{error:'Video not found'});
 }
 if(!/^[a-f0-9]{12}$/.test(token))return J(res,404,{error:'Not found'});
 const found=db.communityVideos.find(v=>v.id===token&&!v.hidden);
 return found?serve(req,res,path.join(COMMUNITY,found.file)):J(res,404,{error:'Video not found'});
}
function videoThumbnailRoute(req,res,url){
 const chunks=url.pathname.split('/'),source=chunks[3],vid=chunks[4];
 if(!['host','community','artist'].includes(source)||!/^[a-f0-9]{12,32}$/.test(vid))return J(res,404,{error:'Not found'});
 let file=null;
 if(source==='host'){
  if(vid.length!==32||db.hiddenHostVideos.includes(vid))return J(res,404,{error:'Unavailable'});
  file=localVideos().files.get(vid);
 }else if(source==='community'){
  const v=db.communityVideos.find(x=>x.id===vid&&!x.hidden);if(v)file=path.join(COMMUNITY,v.file);
 }else{
  const t=db.tracks.find(x=>x.id===vid&&x.kind==='video'&&!x.hidden);if(t)file=path.join(UP,t.media);
 }
 if(!file)return J(res,404,{error:'Video unavailable'});
 const fallback=path.join(ROOT,'public','video-placeholder.svg');
 optimizer.getThumbnail(source,vid,file,result=>{
  if(res.destroyed||res.writableEnded)return;
  if(result)serve(req,res,result,{'Cache-Control':'public,max-age=86400'});
  else serve(req,res,fallback,{'Cache-Control':'public,max-age=120'});
 });
}
function uploadCommunityVideo(req,res,user){
 if(!user)return J(res,401,{error:'Create a free account or sign in to upload a video.'});
 if(user.banned)return J(res,403,{error:'Account suspended'});
 const now=Date.now(), max=250*1024*1024;
 if(db.communityVideos.filter(v=>v.ownerId===user.id&&v.created>now-86400000).length>=10)return J(res,429,{error:'Maximum 10 uploads per account per day.'});
 const existingBytes=db.communityVideos.reduce((n,v)=>n+(v.size||0),0);
 if(existingBytes>=5*1024*1024*1024)return J(res,507,{error:'The server is at its 5 GB community upload capacity.'});
 const url=new URL(req.url,'http://localhost');
 const title=String(url.searchParams.get('title')||'').trim().slice(0,100);
 const soundId=String(url.searchParams.get('soundId')||'');
 const soundtrack=soundId&&db.tracks.find(t=>t.id===soundId&&!t.hidden&&t.kind==='audio');
 if(soundId&&!soundtrack)return J(res,400,{error:'Selected music is unavailable.'});
 const ext=(url.searchParams.get('ext')||'').toLowerCase();
 if(!title)return J(res,400,{error:'Enter a video title.'});
 if(!['.mp4','.webm','.mov','.m4v'].includes(ext))return J(res,415,{error:'Upload an MP4 or WebM video (MOV/M4V also accepted).'});
 if(!['application/octet-stream','video/mp4','video/webm','video/quicktime'].includes(String(req.headers['content-type']||'').split(';')[0]))return J(res,415,{error:'Invalid upload content type.'});
 const length=Number(req.headers['content-length']||0);
 if(length>max)return J(res,413,{error:'Video too large (250 MB maximum).'});
 if(existingBytes+length>5*1024*1024*1024)return J(res,507,{error:'Not enough space remaining in the 5 GB community upload quota.'});
 const vid=id(),file=vid+ext,dest=path.join(COMMUNITY,file),stream=fs.createWriteStream(dest,{flags:'wx'});
 let count=0,failed=false,finished=false;
 const fail=(status,message)=>{if(failed||finished)return;failed=true;req.unpipe(stream);stream.destroy();fs.unlink(dest,()=>{});if(!res.headersSent)J(res,status,{error:message});req.resume();};
 req.on('data',chunk=>{count+=chunk.length;if(count>max)fail(413,'Video exceeds the 250 MB upload limit.');else if(existingBytes+count>5*1024*1024*1024)fail(507,'Community upload quota exceeded.')});
 req.on('aborted',()=>fail(400,'Upload interrupted.'));
 req.on('error',()=>fail(400,'Upload failed.'));
 stream.on('error',()=>fail(507,'Unable to save video to disk.'));
 stream.on('finish',()=>{
  if(failed)return;finished=true;
  if(count<12){fs.unlink(dest,()=>{});return J(res,400,{error:'Video file is empty or invalid.'})}
  let head=Buffer.alloc(12),handle;
  try{handle=fs.openSync(dest,'r');fs.readSync(handle,head,0,12,0);fs.closeSync(handle);}catch(e){if(handle!==undefined)try{fs.closeSync(handle)}catch(e){}fs.unlink(dest,()=>{});return J(res,400,{error:'Cannot verify video.'})}
  const looksMP4=head.toString('ascii',4,8)==='ftyp',looksWebM=head.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
  if(ext==='.webm'?!looksWebM:!looksMP4){fs.unlink(dest,()=>{});return J(res,415,{error:'The file content does not match its video format.'})}
  const video={id:vid,file,title,ownerId:user.id,creator:user.name.slice(0,60),size:count,created:Date.now(),hidden:false};
  video.province=PROVS.includes(user.province)?user.province:'';
  db.communityVideos.push(video);if(soundtrack)db.videoSounds.push({key:'community:'+video.id,trackId:soundtrack.id,by:user.id,d:Date.now()});db.follows.filter(f=>f.a===user.id).slice(0,1000).forEach(f=>notify(f.u,'newvideo',user.id,'community:'+video.id,title));save();
  optimizer.optimizeUpload(video,dest,optimized=>{
   if(!optimized)return;
   const active=db.communityVideos.find(v=>v.id===video.id);
   if(!active){fs.unlink(optimized,()=>{});return}
   const old=active.file;active.file=path.basename(optimized);
   try{active.size=fs.statSync(optimized).size}catch(e){};save();
   fs.unlink(path.join(COMMUNITY,old),()=>{});
  });
  J(res,201,{ok:true,video:{id:vid,title,creator:video.creator}});
 });
 req.pipe(stream);
}
// multipart parser (streams file parts to disk)
function upload(req,u,cb){const bm=/boundary=(.+)$/.exec(req.headers['content-type']||'');if(!bm)return cb('bad');
 const chunks=[];let size=0;req.on('data',d=>{size+=d;if(size>300*1048576){req.destroy()}else chunks.push(d)});
 req.on('end',()=>{const buf=Buffer.concat(chunks),b=Buffer.from('--'+bm[1]),f={},files={};let pos=buf.indexOf(b);
  while(pos>=0){const nx=buf.indexOf(b,pos+b.length);if(nx<0)break;const part=buf.slice(pos+b.length+2,nx-2),he=part.indexOf('\r\n\r\n');
   const hd=part.slice(0,he).toString(),dat=part.slice(he+4),nm=/name="([^"]+)"/.exec(hd),fn=/filename="([^"]*)"/.exec(hd);
   if(nm){if(fn&&fn[1]){const ext=path.extname(fn[1]).toLowerCase();if(!mime[ext]||ext=='.html'||ext=='.js'||ext=='.svg'||ext=='.json'||ext=='.webmanifest')return cb('Unsupported file type');const name=id()+ext;fs.writeFileSync(path.join(UP,name),dat);files[nm[1]]=name}else f[nm[1]]=dat.toString()}
   pos=nx}cb(null,f,files)})}
function cleanVideoSocial(key){db.videoLikes=db.videoLikes.filter(x=>x.key!==key);db.savedVideos=db.savedVideos.filter(x=>x.key!==key);db.videoComments=db.videoComments.filter(x=>x.key!==key);db.videoReports=db.videoReports.filter(x=>x.key!==key);db.videoSounds=db.videoSounds.filter(x=>x.key!==key);db.videoViews=db.videoViews.filter(x=>x.key!==key)}
function videoFromBody(b){return resolvePublicVideo(String(b.key||''))}
function canPost(u){return !!(u&&!u.banned)}
function uploadAvatar(req,res,user){
 if(!user)return J(res,401,{error:'Sign in to update your photo'});
 const length=Number(req.headers['content-length']||0),type=String(req.headers['content-type']||'').split(';')[0];
 const extensions={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'};
 if(!extensions[type])return J(res,415,{error:'Choose a JPEG, PNG or WebP picture'});
 if(length>2*1024*1024)return J(res,413,{error:'Image must be smaller than 2 MB'});
 const filename='avatar-'+id()+extensions[type],dest=path.join(UP,filename),out=fs.createWriteStream(dest,{flags:'wx'});
 let count=0,failed=false,done=false;
 const fail=(status,message)=>{if(failed||done)return;failed=true;req.unpipe(out);out.destroy();fs.unlink(dest,()=>{});if(!res.headersSent)J(res,status,{error:message});req.resume()};
 req.on('data',x=>{count+=x.length;if(count>2*1024*1024)fail(413,'Image too large')});
 req.on('aborted',()=>fail(400,'Upload interrupted'));
 out.on('error',()=>fail(507,'Could not save profile photo'));
 out.on('finish',()=>{
  if(failed)return;done=true;let head=Buffer.alloc(16),fd;
  try{fd=fs.openSync(dest,'r');fs.readSync(fd,head,0,16,0);fs.closeSync(fd)}catch(e){if(fd!==undefined)try{fs.closeSync(fd)}catch(e){}fs.unlink(dest,()=>{});return J(res,400,{error:'Invalid image'})}
  const valid=type==='image/jpeg'?head[0]===255&&head[1]===216&&head[2]===255:type==='image/png'?head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):head.toString('ascii',0,4)==='RIFF'&&head.toString('ascii',8,12)==='WEBP';
  if(!valid||count<24){fs.unlink(dest,()=>{});return J(res,415,{error:'The picture does not match its file type'})}
  const old=user.avatar;user.avatar=filename;save();if(old&&/^avatar-[a-f0-9]{12}\.(jpg|png|webp)$/.test(old))fs.unlink(path.join(UP,old),()=>{});
  J(res,200,{avatar:filename});
 });req.pipe(out);
}

// Phase 4: transparent engagement-based ranking (no inferred private attributes).
const recentGuestViews=new Map();
function phase4Rank(v,u,now,likeByKey,commentsByKey,saveByKey,viewsByKey,profile){
 const key=socialKey(v),age=Math.max(0,(now-(v.created||now))/864e5);
 const activity=(likeByKey.get(key)||0)*4+(commentsByKey.get(key)||0)*3+(saveByKey.get(key)||0)*3+(viewsByKey.get(key)||0)*.6;
 const freshness=12/Math.sqrt(1+age/5),engagement=Math.log1p(activity)*4;
 if(!u)return freshness+engagement;
 const {followed,liked,saved,watched,interest,province}=profile;
 return freshness+engagement+(v.creatorId&&followed.has(v.creatorId)?10:0)+(province&&v.province===province?3:0)+
  (v.creatorId&&interest.some(a=>a.creatorId===v.creatorId)?6:0)+(saved.has(key)?-7:0)+(watched.has(key)?-5:0);
}
function rankVideos(source,u,mode='for-you',province=''){
 const all=source.filter(v=>!province||v.province===province),now=Date.now();
 const counts=a=>{const m=new Map();for(const x of a)m.set(x.key,(m.get(x.key)||0)+1);return m};
 const liked=counts(db.videoLikes),comments=counts(db.videoComments.filter(x=>!x.hidden)),saved=counts(db.savedVideos),views=counts(db.videoViews);
 const followed=u?new Set(db.follows.filter(f=>f.u===u.id).map(f=>f.a)):new Set();
 const userLiked=u?new Set(db.videoLikes.filter(l=>l.u===u.id).map(l=>l.key)):new Set();
 const userSaved=u?new Set(db.savedVideos.filter(l=>l.u===u.id).map(l=>l.key)):new Set();
 const profile={followed,liked:userLiked,saved:userSaved,
  watched:new Set(u?db.videoViews.filter(w=>w.u===u.id&&w.d>now-14*864e5).map(w=>w.key):[]),
  interest:[...userLiked,...userSaved].map(k=>resolvePublicVideo(k)).filter(Boolean),
  province:u&&PROVS.includes(u.province)?u.province:null};
 const picked=(mode==='following'?all.filter(v=>v.creatorId&&followed.has(v.creatorId)):all).map(v=>({v,rank:phase4Rank(v,u,now,liked,comments,saved,views,profile)}));
 if(mode==='trending')picked.forEach(x=>{const key=socialKey(x.v),days=Math.max(0,(now-x.v.created)/864e5);x.rank=((liked.get(key)||0)*4+(comments.get(key)||0)*3+(views.get(key)||0)+1)/Math.pow(days+2,.45)});
 if(mode==='following')picked.sort((a,b)=>b.v.created-a.v.created);
 else picked.sort((a,b)=>b.rank-a.rank||b.v.created-a.v.created);
 // In a mixed feed, avoid a single creator or featured source dominating the first screen.
 if(!province&&mode==='for-you'&&picked.some(x=>x.v.source!=='host')){
  const out=[],waiting=[...picked];let cycle=0;
  while(waiting.length){let i=waiting.findIndex(x=>{
   const last=out.slice(-3),creator=x.v.creatorId||x.v.source;
   return last.filter(y=>(y.v.creatorId||y.v.source)===creator).length<2 && (x.v.source!=='host'||out.filter(y=>y.v.source==='host').length<Math.max(2,Math.floor((out.length+1)*.4)));
  });if(i<0||++cycle>1200)i=0;out.push(waiting.splice(i,1)[0]);}return out.map(x=>x.v);
 }
 return picked.map(x=>x.v);
}
function creatorVideoInsights(u){
 const mine=getPublicVideos().filter(v=>v.creatorId===u.id),ids=new Set(mine.map(socialKey)),since=Date.now()-7*864e5;
 const views=db.videoViews.filter(x=>ids.has(x.key)),likes=db.videoLikes.filter(x=>ids.has(x.key)),comments=db.videoComments.filter(x=>ids.has(x.key)&&!x.hidden),saves=db.savedVideos.filter(x=>ids.has(x.key));
 const daily=Array.from({length:7},(_,i)=>{const day=new Date();day.setHours(0,0,0,0);day.setDate(day.getDate()-(6-i));const start=day.getTime();return {day:day.toLocaleDateString('en-ZA',{weekday:'short'}),count:views.filter(v=>v.d>=start&&v.d<start+864e5).length}});
 const videos=mine.map(v=>({key:socialKey(v),title:v.title,views:views.filter(x=>x.key===socialKey(v)).length,likes:likes.filter(x=>x.key===socialKey(v)).length,comments:comments.filter(x=>x.key===socialKey(v)).length,saves:saves.filter(x=>x.key===socialKey(v)).length})).sort((a,b)=>b.views-a.views).slice(0,40);
 return {summary:{videos:mine.length,views:views.length,views7d:views.filter(x=>x.d>=since).length,likes:likes.length,comments:comments.length,saves:saves.length,followers:db.follows.filter(f=>f.a===u.id).length},daily,videos};
}
function canLinkSound(u,v){return !!(u&&v&&(u.role==='admin'||(v.source==='community'&&db.communityVideos.some(x=>x.id===v.id&&x.ownerId===u.id))||(v.source==='artist'&&v.creatorId===u.id)))}

function feedSocialRoutes(){return {
 'GET /api/video-discover':(q,r,u,url)=>{
  const mode=['for-you','following','trending'].includes(url.searchParams.get('mode'))?url.searchParams.get('mode'):'for-you';
  const province=PROVS.includes(url.searchParams.get('province'))?url.searchParams.get('province'):'';
  J(r,200,{mode,province,videos:rankVideos(getPublicVideos(),u,mode,province).slice(0,200).map(v=>decorateVideo(v,u)),personalized:!!u});
 },
 'GET /api/region-trending':(q,r,u,url)=>{
  const province=PROVS.includes(url.searchParams.get('province'))?url.searchParams.get('province'):'';
  const tracks=db.tracks.filter(x=>!x.hidden&&(!province||x.province===province)).sort((a,b)=>score(b)-score(a)).slice(0,12);
  const videos=rankVideos(getPublicVideos(),u,'trending',province).slice(0,18);
  const creators=db.users.filter(x=>!x.banned&&(!province||x.province===province)&&db.tracks.some(t=>t.artistId===x.id&&!t.hidden)||!x.banned&&(!province||x.province===province)&&db.communityVideos.some(v=>v.ownerId===x.id&&!v.hidden)).slice(0,12).map(pub);
  J(r,200,{province,videos:videos.map(v=>decorateVideo(v,u)),tracks:sendTracks(u,tracks),creators});
 },
 'GET /api/creator/insights':(q,r,u)=>u?J(r,200,creatorVideoInsights(u)):J(r,401,{error:'Sign in to view your creator analytics'}),
 'POST /api/video-view':async(q,r,u)=>{
  const b=await body(q),v=videoFromBody(b);if(!v)return J(r,404,{error:'Video unavailable'});
  const key=v.key,now=Date.now(),recent=u?db.videoViews.some(x=>x.key===key&&x.u===u.id&&now-x.d<3*60000):false;
  const guestKey=!u?crypto.createHash('sha256').update((q.socket.remoteAddress||'')+'|'+(q.headers['user-agent']||'').slice(0,100)+'|'+key).digest('hex'):'';
  if(!u&&recentGuestViews.get(guestKey)>now)return J(r,200,{counted:false});
  if(recent)return J(r,200,{counted:false});
  if(!u){recentGuestViews.set(guestKey,now+3*60000);if(recentGuestViews.size>2000)for(const [k,t] of recentGuestViews)if(t<now)recentGuestViews.delete(k)}
  db.videoViews.push({key,u:u?u.id:null,d:now});if(db.videoViews.length>30000)db.videoViews.splice(0,db.videoViews.length-30000);
  save();J(r,200,{counted:true});
 },
 'GET /api/video-history':(q,r,u)=>{
  if(!u)return J(r,401,{error:'Sign in to see viewing history'});
  const keys=[...new Set(db.videoViews.filter(v=>v.u===u.id).slice(-150).reverse().map(v=>v.key))];
  J(r,200,keys.map(resolvePublicVideo).filter(Boolean).map(x=>decorateVideo(x,u)));
 },
 'DELETE /api/video-history':(q,r,u)=>{
  if(!u)return J(r,401,{error:'Sign in first'});
  for(const v of db.videoViews)if(v.u===u.id)v.u=null;
  save();J(r,200,{ok:true});
 },
 'GET /api/music-library':(q,r,u,url)=>{
  const needle=String(url.searchParams.get('q')||'').trim().toLowerCase().slice(0,80);
  J(r,200,sendTracks(u,db.tracks.filter(t=>!t.hidden&&t.kind==='audio'&&(!needle||(t.title+' '+dec(t).artist).toLowerCase().includes(needle))).slice(0,60)));
 },
 'POST /api/video-sound':async(q,r,u)=>{
  const b=await body(q),v=videoFromBody(b);
  if(!canLinkSound(u,v))return J(r,403,{error:'Only this video’s creator can link music'});
  const trackId=String(b.trackId||'');
  const track=trackId&&db.tracks.find(t=>t.id===trackId&&!t.hidden&&t.kind==='audio');
  if(trackId&&!track)return J(r,404,{error:'Music not found'});
  db.videoSounds=db.videoSounds.filter(x=>x.key!==v.key);
  if(track)db.videoSounds.push({key:v.key,trackId:track.id,by:u.id,d:Date.now()});
  save();J(r,200,{ok:true,track:track?{id:track.id,title:track.title,artist:dec(track).artist}:null});
 },
 'GET /api/music-videos':(q,r,u,url)=>{
  const id=String(url.searchParams.get('id')||'');const track=db.tracks.find(t=>t.id===id&&!t.hidden&&t.kind==='audio');
  if(!track)return J(r,404,{error:'Track unavailable'});
  const keys=db.videoSounds.filter(x=>x.trackId===id).map(x=>x.key);
  J(r,200,{track:dec(track),videos:keys.map(resolvePublicVideo).filter(Boolean).map(v=>decorateVideo(v,u))});
 },

 'POST /api/video-like':async(q,r,u)=>{
  if(!canPost(u))return J(r,401,{error:'Sign in to like videos'});
  const b=await body(q),v=videoFromBody(b);if(!v)return J(r,404,{error:'Video unavailable'});
  const i=db.videoLikes.findIndex(x=>x.u===u.id&&x.key===v.key);
  if(i>=0)db.videoLikes.splice(i,1);else {db.videoLikes.push({u:u.id,key:v.key,d:Date.now()});if(v.creatorId)notify(v.creatorId,'vlike',u.id,v.key,v.title)}
  save();J(r,200,{liked:i<0,likes:db.videoLikes.filter(x=>x.key===v.key).length});
 },
 'POST /api/video-save':async(q,r,u)=>{
  if(!canPost(u))return J(r,401,{error:'Sign in to save videos'});
  const b=await body(q),v=videoFromBody(b);if(!v)return J(r,404,{error:'Video unavailable'});
  const i=db.savedVideos.findIndex(x=>x.u===u.id&&x.key===v.key);
  if(i>=0)db.savedVideos.splice(i,1);else db.savedVideos.push({u:u.id,key:v.key,d:Date.now()});
  save();J(r,200,{saved:i<0});
 },
 'GET /api/saved-videos':(q,r,u)=>{
  if(!u)return J(r,401,{error:'Sign in to see saved videos'});
  J(r,200,db.savedVideos.filter(x=>x.u===u.id).slice(-300).reverse().map(x=>resolvePublicVideo(x.key)).filter(Boolean).map(x=>decorateVideo(x,u)));
 },
 'GET /api/video-comments':(q,r,u,url)=>{
  const v=resolvePublicVideo(url.searchParams.get('key'));
  if(!v)return J(r,404,{error:'Video unavailable'});
  J(r,200,db.videoComments.filter(c=>c.key===v.key&&!c.hidden).slice(-100).map(c=>({...c,name:(db.users.find(x=>x.id===c.u)||{}).name||'Creator',mine:!!(u&&(u.id===c.u||u.role==='admin'))})));
 },
 'POST /api/video-comment':async(q,r,u)=>{
  if(!canPost(u))return J(r,401,{error:'Sign in to comment'});
  const b=await body(q),v=videoFromBody(b),text=String(b.text||'').trim();
  if(!v)return J(r,404,{error:'Video unavailable'});
  if(!text||text.length>400)return J(r,400,{error:'Comment must be 1–400 characters'});
  if(db.videoComments.filter(c=>c.u===u.id&&c.d>Date.now()-3600000).length>=25)return J(r,429,{error:'Comment limit reached. Try again later.'});
  const parent=b.parent?db.videoComments.find(x=>x.id===b.parent&&x.key===v.key&&!x.hidden):null;
  if(b.parent&&!parent)return J(r,400,{error:'Reply target unavailable'});
  const c={id:id(),key:v.key,u:u.id,text,d:Date.now(),p:parent?(parent.p||parent.id):'',hidden:false};
  db.videoComments.push(c);if(v.creatorId)notify(v.creatorId,'vcomment',u.id,v.key,text.slice(0,80));
  if(parent&&parent.u!==v.creatorId)notify(parent.u,'vreply',u.id,v.key,text.slice(0,80));
  save();J(r,201,{ok:true,comment:{...c,name:u.name,mine:true}});
 },
 'DELETE /api/video-comment':(q,r,u,url)=>{
  const c=db.videoComments.find(x=>x.id===url.searchParams.get('id'));
  if(!u||!c||(c.u!==u.id&&u.role!=='admin'))return J(r,403,{error:'Not permitted'});
  c.hidden=true;save();J(r,200,{ok:true});
 },
 'POST /api/video-report':async(q,r,u)=>{
  if(!canPost(u))return J(r,401,{error:'Sign in to report a video'});
  const b=await body(q),v=videoFromBody(b),reason=String(b.reason||'').slice(0,80);
  if(!v)return J(r,404,{error:'Video unavailable'});
  if(!['Spam','Harassment','Copyright','Unsafe content','Other'].includes(reason))return J(r,400,{error:'Choose a reason'});
  if(!db.videoReports.some(x=>x.key===v.key&&x.u===u.id))db.videoReports.push({id:id(),key:v.key,u:u.id,reason,d:Date.now(),resolved:false});
  save();J(r,200,{ok:true});
 },
 'POST /api/video-moderate':async(q,r,u)=>{
  if(!u||u.role!=='admin')return J(r,403,{error:'Admins only'});
  const b=await body(q),key=String(b.key||''),hide=!!b.hide,[source,vid]=key.split(':');
  if(source==='host'&&/^[a-f0-9]{32}$/.test(vid)){
   if(!localVideos().files.has(vid))return J(r,404,{error:'Video unavailable'});
   db.hiddenHostVideos=db.hiddenHostVideos.filter(x=>x!==vid);if(hide)db.hiddenHostVideos.push(vid);
  }else if(source==='community'&&/^[a-f0-9]{12}$/.test(vid)){
   const v=db.communityVideos.find(x=>x.id===vid);if(!v)return J(r,404,{});v.hidden=hide;
  }else if(source==='artist'&&/^[a-f0-9]{12}$/.test(vid)){
   const v=db.tracks.find(x=>x.id===vid&&x.kind==='video');if(!v)return J(r,404,{});v.hidden=hide;
  }else return J(r,400,{error:'Unknown video'});
  save();J(r,200,{ok:true,hidden:hide});
 },
 'GET /api/video-hidden':(q,r,u)=>{
  if(!u||u.role!=='admin')return J(r,403,{error:'Admins only'});
  J(r,200,[...db.hiddenHostVideos.map(vid=>({key:'host:'+vid,title:(localVideos().videos.find(x=>x.id===vid)||{}).name||'Featured video'})),
   ...db.communityVideos.filter(x=>x.hidden).map(x=>({key:'community:'+x.id,title:x.title})),
   ...db.tracks.filter(x=>x.kind==='video'&&x.hidden).map(x=>({key:'artist:'+x.id,title:x.title}))]);
 },
 'GET /api/video-reports':(q,r,u)=>{
  if(!u||u.role!=='admin')return J(r,403,{error:'Admins only'});
  J(r,200,db.videoReports.filter(x=>!x.resolved).slice(-150).reverse().map(x=>({...x,video:resolvePublicVideo(x.key)})));
 },
 'POST /api/video-reports/resolve':async(q,r,u)=>{
  if(!u||u.role!=='admin')return J(r,403,{error:'Admins only'});
  const b=await body(q),x=db.videoReports.find(t=>t.id===b.id);if(!x)return J(r,404,{});
  x.resolved=true;save();J(r,200,{ok:true});
 },
 'GET /api/profile-public':(q,r,u,url)=>{
  const a=db.users.find(x=>x.id===url.searchParams.get('id')&&!x.banned);if(!a)return J(r,404,{error:'Profile unavailable'});
  const vids=db.communityVideos.filter(x=>!x.hidden&&x.ownerId===a.id).map(x=>decorateVideo({id:x.id,source:'community',title:x.title,creator:x.creator,created:x.created,src:'/api/community-video/'+x.id,creatorId:a.id},u));
  const ts=db.tracks.filter(x=>!x.hidden&&x.artistId===a.id);
  J(r,200,{creator:pub(a),followers:db.follows.filter(f=>f.a===a.id).length,following:db.follows.filter(f=>f.u===a.id).length,isFollowing:!!(u&&db.follows.some(f=>f.u===u.id&&f.a===a.id)),videos:vids,tracks:sendTracks(u,ts),isSelf:!!(u&&u.id===a.id)});
 },
  'POST /api/avatar':(q,r,u)=>uploadAvatar(q,r,u),
 'GET /api/following':(q,r,u)=>J(r,200,u?db.follows.filter(x=>x.u===u.id).map(x=>x.a):[]),
 'GET /api/creators':(q,r,u)=>{
  const cr=db.users.filter(x=>!x.banned&&(x.role!=='listener'||db.communityVideos.some(v=>v.ownerId===x.id&&!v.hidden)))
   .map(x=>({...pub(x),followers:db.follows.filter(f=>f.a===x.id).length,content:db.communityVideos.filter(v=>v.ownerId===x.id&&!v.hidden).length+db.tracks.filter(t=>t.artistId===x.id&&!t.hidden).length}));
  cr.sort((a,b)=>b.content-a.content||b.followers-a.followers);J(r,200,cr.slice(0,100));
 },
 'GET /api/search-all':(q,r,u,url)=>{
  const needle=String(url.searchParams.get('q')||'').trim().toLocaleLowerCase().slice(0,100);
  if(!needle)return J(r,200,{tracks:[],videos:[],creators:[]});
  const match=(...xs)=>xs.some(x=>String(x||'').toLocaleLowerCase().includes(needle));
  const creators=db.users.filter(x=>!x.banned&&match(x.name,x.artist,x.bio,x.province)).slice(0,20).map(x=>({...pub(x),followers:db.follows.filter(f=>f.a===x.id).length}));
  const tracks=sendTracks(u,db.tracks.filter(x=>!x.hidden&&match(x.title,x.genre,(db.users.find(y=>y.id===x.artistId)||{}).artist)).slice(0,30));
  const videos=[...localVideos().videos.map(x=>resolvePublicVideo('host:'+x.id)),...db.communityVideos.filter(x=>!x.hidden).map(x=>resolvePublicVideo('community:'+x.id)),...db.tracks.filter(x=>x.kind==='video'&&!x.hidden).map(x=>resolvePublicVideo('artist:'+x.id))].filter(Boolean)
   .filter(x=>match(x.title,x.creator)).slice(0,36).map(x=>decorateVideo(x,u));
  J(r,200,{tracks,videos,creators});
 }
}}
const videoRoutes={
 'GET /api/health':(q,r)=>J(r,200,{ok:true,service:'Mzansi Beats',version:'4.0'}),
 'GET /api/admin/performance':(q,r,u)=>{
  if(!u||u.role!=='admin')return J(r,403,{error:'Admins only'});
  const size=files=>files.reduce((n,v)=>n+(v.size||0),0);
  J(r,200,{optimizer:optimizer.status(),videos:{featured:localVideos().videos.length,community:db.communityVideos.length,uploadsBytes:size(db.communityVideos)},database:{users:db.users.length,tracks:db.tracks.length},backups:'data/backups'});
 },
 'GET /api/public-feed':(req,res,u)=>publicFeed(req,res,u),
 'POST /api/community-video':(req,res,u)=>uploadCommunityVideo(req,res,u),
 'DELETE /api/community-video':async(req,res,u,url)=>{
  const v=db.communityVideos.find(x=>x.id===url.searchParams.get('id'));
  if(!u||!v||(v.ownerId!==u.id&&u.role!=='admin'))return J(res,403,{error:'Only the uploader or an admin can delete this video.'});
  db.communityVideos=db.communityVideos.filter(x=>x!==v);cleanVideoSocial('community:'+v.id);fs.unlink(path.join(COMMUNITY,v.file),()=>{});save();J(res,200,{ok:true});
 },
 'POST /api/community-video/moderate':async(req,res,u)=>{
  if(!u||u.role!=='admin')return J(res,403,{error:'Admin only'});
  const b=await body(req),v=db.communityVideos.find(x=>x.id===b.id);
  if(!v)return J(res,404,{error:'Video not found'});
  v.hidden=!v.hidden;save();J(res,200,{hidden:v.hidden});
 }
};
const routes={...feedSocialRoutes(),
 'POST /api/register':async(q,r)=>{const b=await body(q);if(!b.email||!b.password||b.password.length<6||!b.name)return J(r,400,{error:'Name, email and 6+ char password required'});
  if(db.users.some(u=>u.email===b.email.toLowerCase()))return J(r,400,{error:'Email already registered'});
  const s=crypto.randomBytes(8).toString('hex'),u={id:id(),name:b.name.slice(0,60),email:b.email.toLowerCase(),salt:s,pw:hash(b.password,s),role:b.artist?'artist':'listener',artist:b.artist?b.name.slice(0,60):'',bio:'',province:b.province||'Gauteng',lang:b.lang||'en',monetize:false,price:0,created:Date.now()};
  db.users.push(u);const k=crypto.randomBytes(24).toString('hex');db.sessions[k]=u.id;save();J(r,200,{token:k,user:pub(u)})},
 'POST /api/login':async(q,r)=>{const b=await body(q),u=db.users.find(x=>x.email===(b.email||'').toLowerCase());
  if(!u||hash(b.password||'',u.salt)!==u.pw)return J(r,401,{error:'Wrong email or password'});if(u.banned)return J(r,403,{error:'Account suspended'});
  const k=crypto.randomBytes(24).toString('hex');db.sessions[k]=u.id;save();J(r,200,{token:k,user:pub(u)})},
 'GET /api/me':(q,r,u)=>u?J(r,200,pub(u)):J(r,401,{error:'auth'}),
 'GET /api/meta':(q,r)=>J(r,200,{genres:GENRES,provinces:PROVS,payments:!!(KEY||DEMO)}),
 'GET /api/home':(q,r,u)=>{const T=db.tracks.filter(x=>!x.hidden),by=f=>sendTracks(u,[...T].sort(f).slice(0,12));
  const fav=u?[...new Set(db.likes.filter(l=>l.u===u.id).map(l=>(db.tracks.find(x=>x.id===l.t)||{}).genre))]:[];
  const fol=u?db.follows.filter(f=>f.u===u.id).map(f=>f.a):[];
  const rec=T.filter(x=>fav.includes(x.genre)||fol.includes(x.artistId)).sort((a,b)=>score(b)-score(a)).slice(0,12);
  const rising=db.users.filter(x=>x.artist).map(x=>{const ts=T.filter(t=>t.artistId===x.id);return{id:x.id,name:x.artist,province:x.province,followers:db.follows.filter(f=>f.a===x.id).length,plays:ts.reduce((s,t)=>s+t.plays,0),n:ts.length}}).filter(x=>x.n).sort((a,b)=>a.plays-b.plays||b.followers-a.followers).slice(0,10);
  let because=null;const ll=u&&db.likes.filter(l=>l.u===u.id).pop(),lt=ll&&db.tracks.find(x=>x.id===ll.t);if(lt)because={title:lt.title,tracks:sendTracks(u,T.filter(x=>x.genre===lt.genre&&x.id!==lt.id).sort((a,b)=>score(b)-score(a)).slice(0,12))};J(r,200,{because,trending:by((a,b)=>score(b)-score(a)),newest:by((a,b)=>b.created-a.created),recommended:sendTracks(u,rec),rising})},
 'GET /api/tracks':(q,r,u,url)=>{const p=url.searchParams,s=(p.get('q')||'').toLowerCase();let l=db.tracks.filter(x=>!x.hidden);
  if(p.get('genre'))l=l.filter(x=>x.genre===p.get('genre'));if(p.get('province'))l=l.filter(x=>x.province===p.get('province'));if(p.get('kind'))l=l.filter(x=>x.kind===p.get('kind'));if(p.get('type'))l=l.filter(x=>x.type===p.get('type'));
  if(p.get('artist'))l=l.filter(x=>x.artistId===p.get('artist'));if(p.get('liked')&&u)l=l.filter(x=>db.likes.some(k=>k.u===u.id&&k.t===x.id));
  if(s)l=l.filter(x=>(x.title+' '+dec(x).artist+' '+x.genre+' '+x.province).toLowerCase().includes(s));
  l.sort(p.get('sort')=='new'?(a,b)=>b.created-a.created:(a,b)=>score(b)-score(a));J(r,200,sendTracks(u,l.slice(0,60)))},
 'GET /api/artist':(q,r,u,url)=>{const a=db.users.find(x=>x.id===url.searchParams.get('id'));if(!a)return J(r,404,{});const ts=db.tracks.filter(x=>x.artistId===a.id&&!x.hidden);
  J(r,200,{artist:pub(a),followers:db.follows.filter(f=>f.a===a.id).length,following:!!(u&&db.follows.some(f=>f.u===u.id&&f.a===a.id)),plays:ts.reduce((s,t)=>s+t.plays,0),tracks:sendTracks(u,ts)})},
 'POST /api/upload':(q,r,u)=>{if(!u||u.role==='listener')return J(r,403,{error:'Artist account required'});
  upload(q,u,(e,f,files)=>{if(e)return J(r,400,{error:e});if(!files.media||!f.title)return J(r,400,{error:'Title and media file required'});
   const kind=/\.(mp4|webm)$/.test(files.media)?'video':'audio',x={id:id(),artistId:u.id,title:f.title.slice(0,100),genre:GENRES.includes(f.genre)?f.genre:'Afro Pop',province:PROVS.includes(f.province)?f.province:u.province,lang:f.lang||'en',type:f.type||'single',kind,media:files.media,cover:files.cover||'',plays:0,likes:0,created:Date.now(),price:u.monetize?Math.max(0,+f.price||0):0,album:(f.album||'').slice(0,80),lyrics:(f.lyrics||'').slice(0,8000)};
   db.tracks.push(x);save();J(r,200,x)})},
 'POST /api/play':async(q,r,u)=>{const b=await body(q),x=db.tracks.find(t=>t.id===b.id);if(x){x.plays++;db.plays.push({t:x.id,d:Date.now()});if(db.plays.length>5e4)db.plays.shift();save()}J(r,200,{})},
 'POST /api/like':async(q,r,u)=>{if(!u)return J(r,401,{error:'Log in to like'});const b=await body(q),x=db.tracks.find(t=>t.id===b.id);if(!x)return J(r,404,{});
  const i=db.likes.findIndex(l=>l.u===u.id&&l.t===x.id);if(i>=0){db.likes.splice(i,1);x.likes--}else{db.likes.push({u:u.id,t:x.id});x.likes++;notify(x.artistId,'like',u.id,x.id)}save();J(r,200,{liked:i<0,likes:x.likes})},
 'POST /api/follow':async(q,r,u)=>{if(!u)return J(r,401,{error:'Log in to follow'});const b=await body(q);if(!db.users.some(x=>x.id===b.id&&!x.banned)||b.id===u.id)return J(r,400,{error:'Cannot follow this account'});const i=db.follows.findIndex(f=>f.u===u.id&&f.a===b.id);
  if(i>=0)db.follows.splice(i,1);else if(b.id!==u.id){db.follows.push({u:u.id,a:b.id});notify(b.id,'follow',u.id)}save();J(r,200,{following:i<0,followers:db.follows.filter(f=>f.a===b.id).length})},
 'GET /api/comments':(q,r,u,url)=>{const t=url.searchParams.get('id');J(r,200,db.comments.filter(c=>c.t===t).slice(-100).reverse().map(c=>({...c,name:(db.users.find(x=>x.id===c.u)||{}).name,likes:db.clikes.filter(l=>l.c===c.id).length,liked:!!(u&&db.clikes.some(l=>l.c===c.id&&l.u===u.id))})))},
 'POST /api/comment':async(q,r,u)=>{if(!u)return J(r,401,{error:'Log in to comment'});const b=await body(q),x=db.tracks.find(t=>t.id===b.id);if(!x||!b.text||!String(b.text).trim())return J(r,400,{});let p=null;if(b.parent){p=db.comments.find(c=>c.id===b.parent&&c.t===x.id);if(!p)return J(r,400,{});if(p.p)p=db.comments.find(c=>c.id===p.p)||p}
  const c={id:id(),t:x.id,u:u.id,text:String(b.text).trim().slice(0,500),d:Date.now(),p:p?p.id:''};db.comments.push(c);notify(x.artistId,'comment',u.id,x.id,c.text.slice(0,80));
  if(b.parent){const pa=db.comments.find(k=>k.id===b.parent);if(pa&&pa.u!==x.artistId)notify(pa.u,'reply',u.id,x.id,c.text.slice(0,80))}save();J(r,200,{})},
 'GET /api/playlists':(q,r,u)=>J(r,200,u?db.playlists.filter(p=>p.u===u.id).map(p=>({...p,tracks:sendTracks(u,p.ids.map(i=>db.tracks.find(t=>t.id===i)).filter(Boolean))})):[]),
 'POST /api/playlist':async(q,r,u)=>{if(!u)return J(r,401,{error:'Log in first'});const b=await body(q);let p=db.playlists.find(x=>x.id===b.pid&&x.u===u.id);
  if(!p){p={id:id(),u:u.id,name:(b.name||'My Playlist').slice(0,60),ids:[]};db.playlists.push(p)}
  if(b.add&&!p.ids.includes(b.add))p.ids.push(b.add);if(b.remove)p.ids=p.ids.filter(i=>i!==b.remove);if(b.del)db.playlists=db.playlists.filter(x=>x.id!==p.id);save();J(r,200,{id:p.id})},
 'POST /api/profile':async(q,r,u)=>{if(!u)return J(r,401,{});const b=await body(q);for(const k of['bio','province','lang'])if(typeof b[k]=='string')u[k]=b[k].slice(0,400);
  if(b.artist!==undefined&&u.role!=='listener')u.artist=String(b.artist).slice(0,60);if(b.becomeArtist&&u.role==='listener'){u.role='artist';u.artist=u.name}
  if(b.monetize!==undefined)u.monetize=!!b.monetize;if(b.price!==undefined)u.price=Math.max(0,+b.price||0);save();J(r,200,pub(u))},
 'GET /api/studio':(q,r,u)=>{if(!u||u.role==='listener')return J(r,403,{error:'Artists only'});const ts=db.tracks.filter(x=>x.artistId===u.id),since=Date.now()-7*864e5;
  const days=[...Array(7)].map((_,i)=>{const d0=Date.now()-(6-i)*864e5,s=new Date(d0).setHours(0,0,0,0);return db.plays.filter(p=>ts.some(t=>t.id===p.t)&&p.d>=s&&p.d<s+864e5).length});
  const plays=ts.reduce((s,t)=>s+t.plays,0);const pv={},gv={};ts.forEach(t=>{pv[t.province]=(pv[t.province]||0)+t.plays;gv[t.genre]=(gv[t.genre]||0)+t.plays});const pd=db.payments.filter(p=>p.status==='paid'&&p.artistId===u.id),sm=k=>{const g=pd.filter(p=>p.kind===k).reduce((n,p)=>n+p.amount,0);return{count:pd.filter(p=>p.kind===k).length,gross:+g.toFixed(2),net:+(g*(1-FEE)).toFixed(2)}};J(r,200,{sales:sm('purchase'),tips:sm('tip'),provinces:pv,genres:gv,plays,likes:ts.reduce((s,t)=>s+t.likes,0),followers:db.follows.filter(f=>f.a===u.id).length,earnings:u.monetize?+(plays*0.012).toFixed(2):0,days,tracks:ts,week:db.plays.filter(p=>p.d>since&&ts.some(t=>t.id===p.t)).length})},
 'DELETE /api/track':(q,r,u,url)=>{const x=db.tracks.find(t=>t.id===url.searchParams.get('id'));if(!u||!x||(x.artistId!==u.id&&u.role!=='admin'))return J(r,403,{});
  db.tracks=db.tracks.filter(t=>t!==x);if(x.kind==='video')cleanVideoSocial('artist:'+x.id);for(const f of[x.media,x.cover])if(f)fs.unlink(path.join(UP,f),()=>{});save();J(r,200,{})},
 'GET /api/admin':(q,r,u)=>{if(!u||u.role!=='admin')return J(r,403,{error:'Admins only'});J(r,200,{stats:{users:db.users.length,artists:db.users.filter(x=>x.artist).length,tracks:db.tracks.length,plays:db.tracks.reduce((s,t)=>s+t.plays,0),comments:db.comments.length,communityVideos:db.communityVideos.filter(v=>!v.hidden).length,revenue:+db.payments.filter(p=>p.status==='paid').reduce((n,p)=>n+p.amount,0).toFixed(2)},users:db.users.map(x=>({...pub(x),email:x.email,banned:!!x.banned})),tracks:db.tracks.map(dec),communityVideos:db.communityVideos.map(v=>({id:v.id,title:v.title,creator:v.creator,size:v.size,hidden:v.hidden}))})},
 'POST /api/admin':async(q,r,u)=>{if(!u||u.role!=='admin')return J(r,403,{});const b=await body(q);
  if(b.ban){const x=db.users.find(y=>y.id===b.ban);if(x&&x.role!=='admin'){x.banned=!x.banned;if(x.banned)for(const k in db.sessions)if(db.sessions[k]===x.id)delete db.sessions[k]}}
  if(b.verify){const x=db.users.find(y=>y.id===b.verify);if(x)x.verified=!x.verified}if(b.hide){const x=db.tracks.find(y=>y.id===b.hide);if(x)x.hidden=!x.hidden}save();J(r,200,{})}
};

Object.assign(routes,{
 'GET /api/notifs':(q,r,u)=>{if(!u)return J(r,401,{});J(r,200,{unread:db.notifs.filter(n=>n.to===u.id&&!n.read).length,items:db.notifs.filter(n=>n.to===u.id).slice(-40).reverse().map(n=>({...n,name:(db.users.find(x=>x.id===n.from)||{}).name||'Someone',title:((db.tracks.find(x=>x.id===n.t)||resolvePublicVideo(n.t))||{}).title}))})},
 'POST /api/notifs/read':(q,r,u)=>{if(!u)return J(r,401,{});db.notifs.forEach(n=>{if(n.to===u.id)n.read=1});save();J(r,200,{})},
 'POST /api/clike':async(q,r,u)=>{if(!u)return J(r,401,{error:'Log in to like'});const b=await body(q),c=db.comments.find(x=>x.id===b.id);if(!c)return J(r,404,{});const i=db.clikes.findIndex(l=>l.u===u.id&&l.c===c.id);if(i>=0)db.clikes.splice(i,1);else{db.clikes.push({u:u.id,c:c.id});notify(c.u,'clike',u.id,c.t)}save();J(r,200,{liked:i<0,likes:db.clikes.filter(l=>l.c===c.id).length})},
 'POST /api/pay/init':async(q,r,u)=>{if(!u)return J(r,401,{error:'Sign in to pay'});if(!KEY&&!DEMO)return J(r,400,{error:'Payments are not set up yet'});const b=await body(q),p={id:id(),ref:'mb_'+id()+Date.now().toString(36),u:u.id,status:'pending',created:Date.now(),kind:b.kind};
  if(b.kind==='purchase'){const x=db.tracks.find(t=>t.id===b.t);if(!x||!(x.price>0))return J(r,400,{error:'Not for sale'});if(x.artistId===u.id)return J(r,400,{error:'This is your own track'});if(db.purchases.some(k=>k.u===u.id&&k.t===x.id))return J(r,400,{error:'Already purchased'});p.t=x.id;p.artistId=x.artistId;p.amount=x.price}
  else if(b.kind==='tip'){const a=db.users.find(k=>k.id===b.artist),amt=Math.round(+b.amount);if(!a||!a.monetize||a.id===u.id)return J(r,400,{error:'Tips not available'});if(!(amt>=5&&amt<=5000))return J(r,400,{error:'Tip must be between R5 and R5000'});p.artistId=a.id;p.amount=amt}
  else return J(r,400,{error:'Bad request'});
  const cb=(process.env.BASE_URL||((q.headers['x-forwarded-proto']||'http')+'://'+q.headers.host))+'/?pay='+p.ref;db.payments.push(p);save();if(DEMO)return J(r,200,{url:cb});
  try{const v=await ps('POST','/transaction/initialize',{email:u.email,amount:Math.round(p.amount*100),currency:'ZAR',reference:p.ref,callback_url:cb,metadata:{kind:p.kind,t:p.t||'',artist:p.artistId}});if(!v.status)throw new Error(v.message);J(r,200,{url:v.data.authorization_url})}catch(e){p.status='failed';save();J(r,502,{error:'Payment provider error'})}},
 'GET /api/pay/verify':async(q,r,u,url)=>{if(!u)return J(r,401,{});const p=await settle(url.searchParams.get('ref'));if(!p||p.u!==u.id)return J(r,404,{error:'Unknown payment'});J(r,200,{status:p.status,kind:p.kind,amount:p.amount})},
 'POST /api/pay/webhook':async(q,r)=>{let raw='';for await(const c of q)raw+=c;const sig=q.headers['x-paystack-signature']||'';if(!KEY||crypto.createHmac('sha512',KEY).update(raw).digest('hex')!==sig)return J(r,401,{});let e={};try{e=JSON.parse(raw)}catch(x){}if(e.event==='charge.success'&&e.data&&e.data.reference)await settle(e.data.reference);J(r,200,{})},
 'GET /api/purchases':(q,r,u)=>J(r,200,u?sendTracks(u,db.purchases.filter(p=>p.u===u.id).map(p=>db.tracks.find(t=>t.id===p.t)).filter(Boolean)):[]),
 'POST /api/dlink':async(q,r,u)=>{if(!u)return J(r,401,{});const b=await body(q),x=db.tracks.find(t=>t.id===b.id);if(!x)return J(r,404,{});if(!(x.artistId===u.id||u.role==='admin'||db.purchases.some(k=>k.u===u.id&&k.t===x.id)))return J(r,403,{error:'Buy this track to download it'});const k=crypto.randomBytes(16).toString('hex');DL[k]={t:x.id,exp:Date.now()+3e5};J(r,200,{url:'/api/download?k='+k})},
 'GET /api/download':(q,r,u,url)=>{const d=DL[url.searchParams.get('k')];if(!d||d.exp<Date.now())return J(r,403,{error:'Link expired'});const x=db.tracks.find(t=>t.id===d.t);if(!x)return J(r,404,{});serve(q,r,path.join(UP,x.media),{'Content-Disposition':'attachment; filename="'+(dec(x).artist+' - '+x.title).replace(/[^\w .\-]/g,'_')+path.extname(x.media)+'"'})}
});
const webServer=http.createServer(async(req,res)=>{
 // Only this app's browser origin is allowed to interact with authenticated endpoints.
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','same-origin');
 res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 res.setHeader('Cross-Origin-Resource-Policy','same-origin');
 const url=new URL(req.url,'http://x');
 if((req.method==='GET'||req.method==='HEAD')&&url.pathname.startsWith('/api/video-thumbnail/'))return videoThumbnailRoute(req,res,url);
 if((req.method==='GET'||req.method==='HEAD')&&(url.pathname.startsWith('/api/host-video/')||url.pathname.startsWith('/api/community-video/')))return publicVideoRoute(req,res,url);
 // Retire private-only routes from the old viewer; feed is now genuinely shared.
 if(url.pathname==='/api/local-videos'||url.pathname.startsWith('/api/local-video/'))return J(res,410,{error:'This endpoint has moved to the public feed.'});
 const route=req.method+' '+url.pathname;
 if(limited(req,route)){res.setHeader('Retry-After','60');return J(res,429,{error:'Too many requests. Please try again shortly.'})}
 const u=authUser(req),h=videoRoutes[route]||routes[route];
 if(h){try{if(u&&u.banned)return J(res,403,{error:'Suspended'});return await h(req,res,u,url)}catch(e){console.error(e);return J(res,500,{error:'Server error'})}}
 if((req.method==='GET'||req.method==='HEAD')&&url.pathname.startsWith('/media/')){
  const name=path.basename(url.pathname),hidden=db.tracks.some(x=>x.hidden&&(x.media===name||x.cover===name));
  if(hidden)return J(res,404,{error:'Media unavailable'});
  return serve(req,res,path.join(UP,name));
 }
 if(req.method!=='GET'&&req.method!=='HEAD')return J(res,404,{error:'Not found'});
 // Serve static files from /public only; never serve server.js or /data.
 let rel;
 try{rel=decodeURIComponent(url.pathname)}catch(e){return J(res,400,{error:'Bad path'})}
 if(rel==='/'||rel==='')rel='/index.html';
 const staticFile=path.resolve(ROOT,'public','.'+rel);
 if(!staticFile.startsWith(path.join(ROOT,'public')+path.sep))return J(res,403,{error:'Forbidden'});
 const target=fs.existsSync(staticFile)?staticFile:path.join(ROOT,'public','index.html');
 serve(req,res,target,{'Cache-Control':'no-cache'});
});
webServer.listen(PORT,HOST,()=>{
 console.log('Mzansi Beats listening on http://localhost:'+PORT);
 console.log('LAN: http://<YOUR-PC-IP>:'+PORT+' | Internet visitors need a secure public HTTPS tunnel.');
 console.log('PUBLIC PC VIDEO LIBRARY: '+VIDEO_DIR+' ('+videoLocation.source+')');
 const dirStatus=directoryStatus(VIDEO_DIR);
 if(!dirStatus.available){
  console.warn('VIDEO FOLDER NOT CONNECTED: '+dirStatus.status);
  console.warn('On your Windows PC, run CHOOSE-VIDEOS-FOLDER.bat to select the folder, then restart START-WINDOWS.bat.');
  if(process.platform!=='win32')console.warn('This Node.js server is NOT running on Windows, so it cannot read C:\\Users\\elles\\Videos.');
 }else console.log('VIDEO FOLDER CONNECTED: '+localVideos().videos.length+' videos found.');
 console.log('WARNING: all supported videos in this directory and scanned subfolders are publicly streamable.');
});

// Save pending account/social updates on ordinary Windows terminal shutdown.
let shuttingDown=false;
async function shutdown(){if(shuttingDown)return;shuttingDown=true;
 webServer.close();try{await store.flush()}catch(e){console.error('Final save failed',e.message)}process.exit(0)}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
