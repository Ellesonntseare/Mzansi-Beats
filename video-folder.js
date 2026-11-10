// Resolve the public host library on the computer running the Node.js server.
// Web browsers never provide the local server with a folder automatically.
const fs=require('fs'),path=require('path'),os=require('os'),child=require('child_process');
function normalize(raw){
 const s=String(raw||'').replace(/^\uFEFF/,'').trim().replace(/^"(.*)"$/,'$1');
 return s?path.resolve(s):'';
}
function specialWindowsVideos(){
 if(process.platform!=='win32')return '';
 try{
  return normalize(child.execFileSync('powershell.exe',[
   '-NoProfile','-NonInteractive','-Command',"[Environment]::GetFolderPath('MyVideos')"
  ],{timeout:4500,encoding:'utf8',windowsHide:true}).trim());
 }catch(e){return ''}
}
function directoryStatus(dir){
 try{
  const st=fs.statSync(dir);
  if(!st.isDirectory())return {available:false,status:'not-directory'};
  fs.readdirSync(dir);
  return {available:true,status:'connected'};
 }catch(e){
  return {available:false,status:e.code==='EACCES'||e.code==='EPERM'?'permission-denied':'missing'};
 }
}
function resolveVideoDirectory(root){
 const configFile=path.join(root,'VIDEO-FOLDER.txt');
 let saved='';try{saved=normalize(fs.readFileSync(configFile,'utf8'))}catch(e){}
 const explicit=normalize(process.env.VIDEO_DIR)||saved;
 if(explicit)return {dir:explicit,source:process.env.VIDEO_DIR?'VIDEO_DIR environment variable':'VIDEO-FOLDER.txt',configured:true};
 const home=os.homedir(),known=specialWindowsVideos();
 // Prefer the exact library requested by this PC owner when it exists.
 // Other Windows installations can use their configured Videos special folder.
 const candidates=process.platform==='win32'?['C:\\Users\\elles\\Videos',known,path.join(home,'Videos')]:[path.join(home,'Videos')];
 if(process.platform==='win32'){
  const profile=process.env.USERPROFILE||home;
  candidates.push(path.join(profile,'Videos'));
  for(const oneDrive of [process.env.OneDrive,process.env.OneDriveConsumer,process.env.OneDriveCommercial]){
   if(oneDrive)candidates.push(path.join(oneDrive,'Videos'));
  }
  candidates.push('C:\\Users\\elles\\Videos');
 }
 const valid=[...new Set(candidates.filter(Boolean).map(normalize))];
 const found=valid.find(p=>directoryStatus(p).available);
 return {dir:found||valid[0]||path.join(home,'Videos'),source:found?'automatic discovery':'fallback location',configured:false};
}
module.exports={resolveVideoDirectory,directoryStatus};
