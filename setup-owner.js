// Create the owner/admin locally before opening public access.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),readline=require('readline');
const dbFile=path.join(__dirname,'data','db.json');fs.mkdirSync(path.dirname(dbFile),{recursive:true});
let db={};try{db=JSON.parse(fs.readFileSync(dbFile,'utf8'))}catch(e){db={}}
if(!Array.isArray(db.users))db.users=[];if(!db.sessions)db.sessions={};
if(db.users.some(u=>u.role==='admin')){console.log('An admin already exists. Sign in with the existing owner account.');process.exit(0)}
const rl=readline.createInterface({input:process.stdin,output:process.stdout});
const ask=q=>new Promise(r=>rl.question(q,r));
(async()=>{try{
const name=(await ask('Owner display name: ')).trim();
const email=(await ask('Owner email address: ')).trim().toLowerCase();
const password=await ask('Owner password (12+ characters; input visible): ');
if(!name||!email.includes('@')||password.length<12||db.users.some(u=>u.email===email))throw Error('Enter a valid name, unique email and password of at least 12 characters.');
const salt=crypto.randomBytes(8).toString('hex');db.users.push({id:crypto.randomBytes(6).toString('hex'),name:name.slice(0,60),email,salt,pw:crypto.scryptSync(password,salt,32).toString('hex'),role:'admin',artist:'',bio:'',province:'Gauteng',lang:'en',monetize:false,price:0,created:Date.now()});
const temp=dbFile+'.setup.tmp';fs.writeFileSync(temp,JSON.stringify(db,null,2),{mode:0o600});fs.renameSync(temp,dbFile);
console.log('Owner account created. You can now sign in through the website.');
}catch(e){console.error(e.message);process.exitCode=1}finally{rl.close()}})();
