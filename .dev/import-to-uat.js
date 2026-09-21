// ใช้ทดสอบ: node .dev/import-to-uat.js  → นำเข้าไฟล์ใบราคาจริง 4 ชุดเข้า UAT ผ่าน API (ต้องมี .dev/xlsx.full.min.js)
const XLSX=require('./xlsx.full.min.js'),fs=require('fs'),path=require('path'),https=require('https');
const P=require('../frontend-admin/pricelist-parser.js');
const URL_=process.env.UAT_URL, USER=process.env.UAT_USER||'admin', PASS=process.env.UAT_PASS||'ChangeMe123!';
if(!URL_){console.error('ตั้ง UAT_URL ก่อน');process.exit(1);}
async function call(body){ const r=await fetch(URL_,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(body),redirect:'follow'}); return r.json(); }
const GROUPS=[['กรุงเทพ','ร้านค้า กทม./กลาง/ตะวันตก'],['เหนือ','ร้านค้า เหนือ/อีสาน/ตะวันออก/ใต้'],['ซุปเปอร์ชีป','ซุปเปอร์ชีป'],['ศูนย์','ศูนย์/ตัวแทนจำหน่าย']];
(async()=>{
  const login=await call({action:'adminLogin',payload:{username:USER,password:PASS}}); if(!login.success) throw new Error(login.message);
  const token=login.token, dir=path.join(__dirname,'..','reference');
  for(const f of fs.readdirSync(dir).filter(x=>x.startsWith('Go Live')&&x.endsWith('.xlsx'))){
    const s=P.parse(XLSX,fs.readFileSync(path.join(dir,f)),{type:'buffer'}).sheets[0];
    const period=P.parsePeriod(s.title), grp=GROUPS.find(g=>f.includes(g[0]));
    const res=await call({action:'importPriceList',token,payload:{name:grp[1]+' '+period.from+'..'+period.to,customerGroupName:grp[1],validFrom:period.from,validTo:period.to,sourceFile:f,lines:s.items,billPromos:s.billPromos}});
    console.log(grp[1],'=>',JSON.stringify({ok:res.success,id:res.id,stats:res.stats,warnings:res.warnings,msg:res.message}));
  }
})().catch(e=>{console.error(e);process.exit(1)});
