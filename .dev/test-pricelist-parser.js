// รัน: node .dev/test-pricelist-parser.js   (ต้องมี .dev/xlsx.full.min.js — ดาวน์โหลดจาก CDN ไม่ commit)
const XLSX=require('./xlsx.full.min.js'), fs=require('fs'), path=require('path');
const P=require('../frontend-admin/pricelist-parser.js');
const dir=path.join(__dirname,'..','reference');
for (const f of fs.readdirSync(dir).filter(x=>x.endsWith('.xlsx')&&x.startsWith('Go Live'))) {
  const res=P.parse(XLSX, fs.readFileSync(path.join(dir,f)), {type:'buffer'});
  console.log('\n=====',f.slice(0,60),'| sheets:',res.sheets.length,'hiddenSheetsSkipped:',res.skippedHiddenSheets);
  for (const s of res.sheets) {
    console.log(' title:',s.title.slice(0,110));
    console.log(' cash:',s.hasCash,'credit:',s.hasCredit,'items:',s.items.length,'billPromos:',JSON.stringify(s.billPromos.map(b=>[b.minAmountExVat,b.percent])));
    for (const it of s.items) console.log('  -',it.codes.join('/'),'|',it.pack,'| list',it.listExVat,'/',it.listInclVat,'| tiers',it.tiers.map(t=>`${t.min}-${t.max===null?'∞':t.max}:${t.cashInclVat}/${t.creditInclVat}`).join(' '),'| packs',it.packs.map(p=>`${p.cashInclVat}`).join(','),'| sug',it.suggestedPack,'retail',it.retailPiece,'| names',it.names.length);
    console.log(' warnings:',s.warnings.length? '\n   '+s.warnings.join('\n   ') : 'none');
  }
}
