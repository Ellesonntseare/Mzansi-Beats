// Serialized, atomic JSON snapshots and rotating daily backup copies.
'use strict';
const fs=require('fs'),path=require('path');
module.exports=function createStore(filename,getState){
 const folder=path.join(path.dirname(filename),'backups');fs.mkdirSync(folder,{recursive:true});
 let timer=null,pending=false,writing=false;
 function backupOnStartup(){
  if(!fs.existsSync(filename))return;
  const day=new Date().toISOString().slice(0,10),dest=path.join(folder,'db-'+day+'.json');
  try{if(!fs.existsSync(dest))fs.copyFileSync(filename,dest,fs.constants.COPYFILE_EXCL)}catch(e){console.error('[backup]',e.message)}
  try{const list=fs.readdirSync(folder).filter(n=>/^db-\d{4}-\d\d-\d\d\.json$/.test(n)).sort().reverse();for(const name of list.slice(7))fs.unlinkSync(path.join(folder,name))}catch(e){}
 }
 backupOnStartup();
 const backupTimer=setInterval(backupOnStartup,6*60*60*1000);backupTimer.unref();
 async function write(){if(writing)return;writing=true;
  while(pending){
   pending=false;const snapshot=JSON.stringify(getState());const temp=filename+'.tmp';
   try{await fs.promises.writeFile(temp,snapshot,{mode:0o600});await fs.promises.rename(temp,filename)}catch(e){console.error('[database] Snapshot failed:',e.message);pending=true;break}
  }
  writing=false;
 }
 function save(){pending=true;clearTimeout(timer);timer=setTimeout(write,180)}
 async function flush(){clearTimeout(timer);pending=true;while(writing)await new Promise(r=>setTimeout(r,20));await write()}
 return{save,flush};
};
