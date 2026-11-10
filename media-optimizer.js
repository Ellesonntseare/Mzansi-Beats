// Phase 3: optional dependency-free FFmpeg bridge. Never modifies host library files.
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {spawn,spawnSync}=require('child_process');
module.exports=function createMediaOptimizer(root){
 const ffmpeg=process.env.FFMPEG_PATH||'ffmpeg',ffprobe=process.env.FFPROBE_PATH||'ffprobe';
 const thumbnails=path.join(root,'data','video-thumbnails');
 fs.mkdirSync(thumbnails,{recursive:true});
 const ffmpegAvailable=spawnSync(ffmpeg,['-version'],{timeout:2500,stdio:'ignore'}).status===0;
 const ffprobeAvailable=ffmpegAvailable&&spawnSync(ffprobe,['-version'],{timeout:2500,stdio:'ignore'}).status===0;
 const thumbnailJobs=new Map(),thumbQueue=[],convertQueue=[];
 let makingThumb=false,converting=false,thumbnailsBuilt=0,converted=0,failed=0;
 const enabledTranscoding=ffmpegAvailable&&process.env.VIDEO_TRANSCODE!=='0';
 const allowed=['host','community','artist'];
 function thumbName(source,id,st){const hash=crypto.createHash('sha256').update(source+':'+id+':'+st.size+':'+Math.floor(st.mtimeMs)).digest('hex');return path.join(thumbnails,hash+'.jpg')}
 function spawnJob(exe,args,timeout=30000){return new Promise(resolve=>{
  let complete=false,stderr='',child;const finish=ok=>{if(complete)return;complete=true;clearTimeout(timer);resolve(ok)};
  try{child=spawn(exe,args,{windowsHide:true,stdio:['ignore','ignore','pipe']})}catch(e){return resolve(false)}
  child.stderr.on('data',x=>{stderr+=x.toString().slice(0,300)});
  child.on('error',()=>finish(false));child.on('close',code=>finish(code===0));
  const timer=setTimeout(()=>{child.kill();finish(false)},timeout);
 })}
 function processThumbs(){if(makingThumb||!thumbQueue.length)return;
  makingThumb=true;const job=thumbQueue.shift();
  spawnJob(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-ss','0.3','-i',job.source,'-frames:v','1','-vf','scale=360:640:force_original_aspect_ratio=decrease:force_divisible_by=2','-q:v','5','-f','image2','-y',job.tmp],20000).then(ok=>{
   if(ok){try{fs.renameSync(job.tmp,job.output);thumbnailsBuilt++}catch(e){ok=false}}
   if(!ok){failed++;try{fs.unlinkSync(job.tmp)}catch(e){}}
   thumbnailJobs.delete(job.output);job.done(ok);makingThumb=false;setImmediate(processThumbs);
  });
 }
 function getThumbnail(source,id,file,done){
  if(!allowed.includes(source)||!/^[a-f0-9]{12,32}$/.test(id)||!ffmpegAvailable)return done(null);
  fs.stat(file,(err,st)=>{
   if(err||!st.isFile())return done(null);
   const output=thumbName(source,id,st);
   if(fs.existsSync(output))return done(output);
   if(thumbnailJobs.has(output))return thumbnailJobs.get(output).then(ok=>done(ok?output:null));
   if(thumbQueue.length>=50)return done(null);
   let resolveJob;const promise=new Promise(resolve=>resolveJob=resolve);thumbnailJobs.set(output,promise);
   thumbQueue.push({source:file,output,tmp:output+'.tmp.jpg',done:resolveJob});processThumbs();
   promise.then(ok=>done(ok?output:null));
  });
 }
 function probe(file){if(!ffprobeAvailable)return null;const p=spawnSync(ffprobe,['-v','error','-select_streams','v:0','-show_entries','stream=codec_name','-of','default=noprint_wrappers=1:nokey=1',file],{timeout:5000,encoding:'utf8'});return p.status===0?p.stdout.trim():null}
 function processConversions(){if(converting||!convertQueue.length)return;
  converting=true;const job=convertQueue.shift();const target=path.join(job.dir,job.id+'-optimized.mp4'),tmp=target+'.partial.mp4';
  const args=['-hide_banner','-loglevel','error','-nostdin','-y','-i',job.original,'-map','0:v:0','-map','0:a?','-vf','scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2','-c:v','libx264','-preset','veryfast','-crf','26','-pix_fmt','yuv420p','-threads','2','-c:a','aac','-b:a','96k','-movflags','+faststart','-f','mp4',tmp];
  spawnJob(ffmpeg,args,360000).then(ok=>{
   if(ok){try{if(fs.statSync(tmp).size<200){ok=false}else fs.renameSync(tmp,target)}catch(e){ok=false}}
   if(ok){converted++;job.finished(target)}else{failed++;try{fs.unlinkSync(tmp)}catch(e){};job.finished(null)}
   converting=false;setImmediate(processConversions);
  });
 }
 function optimizeUpload(video,file,finished){
  if(!enabledTranscoding)return;
  if(video.file.endsWith('.mp4')&&probe(file)==='h264')return;
  if(convertQueue.length>=30)return;
  convertQueue.push({original:file,dir:path.dirname(file),id:video.id,finished});processConversions();
 }
 function status(){return{ffmpegAvailable,ffprobeAvailable,transcodingEnabled:enabledTranscoding,thumbnailQueue:thumbQueue.length+(makingThumb?1:0),conversionQueue:convertQueue.length+(converting?1:0),thumbnailsBuilt,converted,failed}}
 return{getThumbnail,optimizeUpload,status};
};
