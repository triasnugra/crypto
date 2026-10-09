// asgracrypto: uji engine.mjs terhadap post Eliz. Jalan di browser dan Node (node validate.mjs [--baseline]).
// Engine hanya diberi data sampai detik post. Candle terakhir dibangun ulang dari data 15 menit agar tidak mengintip masa depan.
import {bj,analyze,fmt} from './engine.mjs';
export const VERSION='v4 (v1 stop wick vs v4 stop close; default situs = v1)';
const M15=9e5,H1=36e5,DAY=864e5,T=s=>typeof s==='number'?s:Date.parse(s),pc=(a,b)=>(a/b-1)*100;
const mk=a=>({t:a[0],o:+a[1],h:+a[2],l:+a[3],c:+a[4],v:+a[5]});
const K=async(p,iv,q)=>(await bj(`klines?symbol=${p}&interval=${iv}&${q}`)).map(mk);
const pairOf=e=>e.pair||e.sym+'USDT';

async function part(p,last,ts){const k=(await K(p,'15m',`startTime=${last.t}&endTime=${ts}&limit=1000`)).filter(q=>q.t+M15<=ts);
 return k.length?{t:last.t,o:k[0].o,h:Math.max(...k.map(q=>q.h)),l:Math.min(...k.map(q=>q.l)),c:k.at(-1).c,v:k.reduce((s,q)=>s+q.v,0)}:{...last,h:last.o,l:last.o,c:last.o,v:0}}
async function snap(p,ts){const[d,f]=await Promise.all([K(p,'1d',`endTime=${ts}&limit=500`),K(p,'4h',`endTime=${ts}&limit=300`)]);
 if(!d.length||!f.length)throw new Error('tidak ada data '+p+' pada waktu itu');
 const[pd,pf]=await Promise.all([part(p,d.at(-1),ts),part(p,f.at(-1),ts)]);d[d.length-1]=pd;f[f.length-1]=pf;return{d,f}}
const bc=new Map();
const btcBias=ts=>{if(!bc.has(ts))bc.set(ts,snap('BTCUSDT',ts).then(({d,f})=>analyze('BTC',d,f,{qv:1e9}).bias).catch(()=>0));return bc.get(ts)};
// Satu snapshot data, dua varian dengan setup IDENTIK: v1 (stop tersentuh wick) dan v4 (stop baru berlaku bila candle penutup close melewati SL).
async function at(sym,p,ts){const{d,f}=await snap(p,ts),qv=d.at(-2).v*d.at(-2).c,bb=sym==='BTC'?0:await btcBias(ts);
 return{d,R:{v1:analyze(sym,d,f,{btcBias:bb,qv,legacy:true}),v4:analyze(sym,d,f,{btcBias:bb,qv,legacy:true,closeStop:true})}}}
const pxAt=async(p,ts)=>{const k=await K(p,'15m',`endTime=${ts}&limit=3`);if(!k.length)throw new Error('tanpa data harga');return(k.filter(q=>q.t+M15<=ts).at(-1)||k.at(-1)).c};
const fwd=(p,ts,days)=>K(p,'1h',`startTime=${Math.ceil(ts/H1)*H1}&endTime=${ts+Math.min(40,days)*DAY}&limit=1000`);
async function pool(items,n,fn){const out=new Array(items.length);let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<items.length){const k=i++;out[k]=await fn(items[k],k)}}));return out}

// Candle 1H penutup untuk timeframe tf (semua candle Binance selaras UTC). Epoch = Kamis 00:00, jadi close weekly = Minggu 23:00 UTC.
export const isClose=(q,tf)=>{const h=Math.floor(q.t/H1);return tf==='4H'?h%4===3:tf==='1W'?h%168===95:h%24===23};
// Simulasi plan engine pada candle 1H ke depan. Konservatif: stop dihitung lebih dulu bila satu candle menyentuh stop dan target.
// Aturan: entry limit, 70% ditutup di TP1 lalu stop pindah ke entry, 30% ke target akhir. Candle saat entry terisi hanya dicek stop-nya.
// Mode stop 'wick' (default): stop kena bila harga menyentuh SL, rugi tepat 1R. Mode 'close' (p.stopMode): stop hanya kena bila candle penutup p.stopTf
// close melewati SL, dan keluar di harga close itu, jadi rugi bisa lebih dari 1R. Target tetap sentuhan wick (order limit).
export function sim(p,fc){const L=p.side==1,CL=p.stopMode==='close',tg=p.tg.map(t=>t.v),t1=tg[0],tf=tg.at(-1),r1=Math.abs(t1-p.entry)/p.risk,rf=Math.abs(tf-p.entry)/p.risk,one=tg.length==1;
 const i0=fc.findIndex(q=>L?q.l<=p.entry:q.h>=p.entry);if(i0<0)return{st:'tidak terisi',R:0};
 let stage=0;
 for(let i=i0;i<fc.length;i++){const q=fc[i],stop=stage?p.entry:p.sl,hs=CL?isClose(q,p.stopTf)&&(L?q.c<=stop:q.c>=stop):(L?q.l<=stop:q.h>=stop),x=CL?q.c:stop,h1=L?q.h>=t1:q.l<=t1,hf=L?q.h>=tf:q.l<=tf,jam=i-i0;
  if(hs){const Rx=p.side*(x-p.entry)/p.risk;return stage?{st:'TP1 lalu stop di entry',R:.7*r1+.3*Rx,jam}:{st:'SL',R:Rx,jam}}
  if(i===i0)continue;
  if(stage){if(hf)return{st:'target akhir',R:.7*r1+.3*rf,jam}}
  else if(one){if(hf)return{st:'target',R:rf,jam}}
  else if(h1){stage=1;if(hf)return{st:'target akhir',R:.7*r1+.3*rf,jam}}}
 const o=p.side*(fc.at(-1).c-p.entry)/p.risk;return{st:'masih terbuka',R:stage?.7*r1+.3*o:o,jam:fc.length-i0}}

function claim(c,e,r,d,fc,rts,ts){const dir=c.dir??e.dir??1,L=dir==1,base=c.base??(c.altBase?Math.min(...d.slice(-31,-1).map(q=>q.l)):r.px),
 by=T(c.by||(e.result&&e.result.ts)||ts)+H1;
 if(c.kind==='close'){ // klaim berbasis close (invalidasi atau konfirmasi): dir -1 = ada close di bawah level, dir 1 = ada close di atas level
  const o={text:c.text,info:!!c.info,conditional:true,base:r.px,level:c.level,ach:null},tf=(c.tf||'1D').toUpperCase(),hit=fc.find(q=>isClose(q,tf)&&(dir<0?q.c<c.level:q.c>c.level));
  return fc.length?{...o,verdict:hit?'terjadi':'tidak terjadi',at:hit?new Date(hit.t).toISOString():null}:{...o,verdict:'tanpa data',at:null}}
 const lvl=c.level??base*(1+dir*.9*c.pct/100),w=fc.filter(q=>q.t<=by),o={text:c.text,info:!!c.info,conditional:!!c.conditional,base,level:lvl};
 if(!fc.length)return{...o,ach:null,verdict:'tanpa data',at:null};
 const W=w.length?w:fc,ex=L?Math.max(...W.map(q=>q.h)):Math.min(...W.map(q=>q.l)),i=fc.findIndex(q=>L?q.h>=lvl:q.l<=lvl);
 return{...o,ach:+(dir*pc(ex,base)).toFixed(1),verdict:i<0?'tidak tercapai':fc[i].t<=by?'tercapai tepat waktu':'tercapai, tapi setelah klaim',at:i<0?null:new Date(fc[i].t).toISOString()}}

function engLevels(r){const o=[];for(const[n,fr]of[['4H',r.f4],['1D',r.f1]]){if(!fr)continue;o.push([fr.L,'low '+n],[fr.L+fr.bd,'atas demand '+n],[fr.M,'tengah '+n],[fr.H-fr.bd,'bawah supply '+n],[fr.H,'high '+n]);if(fr.mon)o.push([fr.mon.l,'Monday low'],[fr.mon.h,'Monday high'])}
 for(const s of r.setups)o.push([s.entry,'entry '+s.tf],[s.sl,'SL '+s.tf]);
 if(r.wk){for(const[n,z]of[['supply',r.wk.sup],['demand',r.wk.dem]])if(z)o.push([z.lo,'weekly '+n+' bawah'],[z.hi,'weekly '+n+' atas'],[z.m,'weekly '+n]);o.push([r.wk.H,'weekly high 52m'],[r.wk.L,'weekly low 52m'])}
 return o}
function lvCheck(e,r){const EL=engLevels(r),tol=Math.max(.012*r.px,r.f4?.A||0),W=[];
 for(const l of e.levels||[])if(!/^target/.test(l.role))W.push({v:l.v,lab:l.role});
 for(const z of e.zones||[])W.push({lo:z.lo,hi:z.hi,lab:z.role});
 let hit=0;const miss=[];
 for(const w of W){const pts=w.v!=null?[w.v]:[w.lo,w.hi,(w.lo+w.hi)/2];let b=null;
  for(const p of pts)for(const[v,n]of EL){const dd=Math.abs(v-p);if(!b||dd<b.dd)b={dd,n,v}}
  const inside=w.v==null&&EL.some(([v])=>v>=w.lo-tol&&v<=w.hi+tol);
  if(b&&(b.dd<=tol||inside))hit++;else miss.push(`${w.lab} ${w.v??w.lo+'-'+w.hi} (terdekat: ${b?b.n+' '+fmt(b.v):'-'})`)}
 return{hit,total:W.length,miss}}

const PM={dev:'sweep-reclaim',tap:'sweep-reclaim',dd:'sweep-reclaim',mon:'sweep-reclaim',bo:'breakout-retest',tlb:'trendline-break',wolf:'wolf',zone:'retest-zone'};
// Penilaian: setup "aktif" = entry dalam 0,5 persen dari harga. Order tunda jauh di ekstrem range bukan kontradiksi dengan Eliz yang menunggu ekstrem.
export function grade(e,r,lv){const b=r.best,fr=r.f4||r.f1,S=r.setups,act=!!(b&&b.dist<=.5),same=S.filter(s=>s.side===e.dir),pk=new Set(same.map(s=>PM[s.kind])),patOk=(e.pat||[]).some(p=>pk.has(p)),dirOk=!!(b&&b.side===e.dir);let v,n='';
 if(e.cls==='setup'){v=dirOk&&patOk?'sama':dirOk||same.length?'sebagian':act?'berlawanan':'tidak terdeteksi';
  n=dirOk?(patOk?'arah dan pola sama':'arah sama, pola beda'):same.length?'ada setup searah tapi bukan yang terbaik':act?'engine aktif di arah sebaliknya':b?'hanya ada order tunda berlawanan':'engine tidak melihat pemicu ('+r.st+')'}
 else if(e.cls==='bias'){const x=act?b.side:r.bias;v=x===e.dir?'sama':x===0?'sebagian':'beda';n=act?'setup aktif engine: '+(b.side>0?'long':'short'):'struktur harian engine: '+['turun','datar','naik'][r.bias+1]}
 else if(e.cls==='notrade'){v=act?'beda':b||fr.mid||fr.flat?'sama':'sebagian';n=act?'engine memberi setup aktif padahal Eliz diam':b?'engine hanya menyiapkan order tunda di ekstrem':fr.mid?'engine juga di tengah range':'engine diam, tetapi harga tidak di tengah range'}
 else if(e.cls==='scenario'){const q=lv.total?lv.hit/lv.total:0;v=q>=.6?'sama':q>0?'sebagian':'tidak terdeteksi';n='dinilai dari kecocokan level, bukan arah'}
 else v='dilewati';
 return{verdict:v,note:n,patOk,dirOk}}

const engSum=r=>{const b=r.best;return{bias:r.bias,st:r.st,n:r.setups.length,best:b&&{side:b.side,tf:b.tf,kind:b.kind,why:b.why,entry:b.entry,sl:b.sl,tp:b.tg.map(t=>t.v),rr:b.rr,type:b.type,cf:b.cf[1],dist:b.dist,w:b.w},
 lain:r.setups.slice(1).map(s=>`${s.side==1?'L':'S'} ${s.tf} ${s.kind}`),
 wk:r.wk&&{sup:r.wk.sup&&[r.wk.sup.lo,r.wk.sup.hi],dem:r.wk.dem&&[r.wk.dem.lo,r.wk.dem.hi]},
 frames:Object.fromEntries([['4h',r.f4],['1d',r.f1]].filter(a=>a[1]).map(([k,fr])=>[k,{H:fr.H,L:fr.L,pos:+fr.pos.toFixed(2),mid:fr.mid,flat:fr.flat,mon:fr.mon&&{h:fr.mon.h,l:fr.mon.l}}]))}};
const evalV=(e,r,fc,ts)=>{const b=r.best,o={engine:engSum(r)};
 if(['invest','context'].includes(e.cls))o.grade={verdict:'dilewati',note:'bukan setup trading'};
 else{o.levels=lvCheck(e,r);o.grade=grade(e,r,o.levels);if(b)o.sim=sim(b,fc.filter(q=>q.t<=ts+(e.horizonDays||7)*DAY))}
 return o};

async function runOne(e){let ts=T(e.ts);const p=pairOf(e),o={id:e.id,sym:e.sym,ts:e.ts,cls:e.cls,dir:e.dir,note:e.note||'',flags:e.flags||[]};
 try{
  // Jam post tidak diketahui tetapi tanggal chart dan harganya ada: cari candle 15m pada rentang probe yang close-nya paling dekat dengan harga di chart.
  if(e.probe&&e.pxShown){const k=await K(p,'15m',`startTime=${T(e.probe[0])}&endTime=${T(e.probe[1])}&limit=1000`);
   if(k.length){let b=k[0];for(const q of k)if(Math.abs(q.c-e.pxShown)<Math.abs(b.c-e.pxShown))b=q;ts=b.t+M15;o.tsEst=new Date(ts).toISOString();o.tsEstDiff=+pc(b.c,e.pxShown).toFixed(2)}}
  const{d,R}=await at(e.sym,p,ts),r=R.v1;o.px=r.px;
  if(e.pxShown){o.pxShown=e.pxShown;o.pxDiff=+pc(r.px,e.pxShown).toFixed(2);o.tsSuspect=Math.abs(o.pxDiff)>2}
  const res=e.result,rts=res?T(res.ts):null,days=Math.max(e.horizonDays||7,rts?(rts-ts)/DAY+1:0),fc=await fwd(p,ts,days);
  Object.assign(o,evalV(e,R.v1,fc,ts));
  o.v4=R.v4.best&&o.grade.verdict!=='dilewati'?{sim:sim(R.v4.best,fc.filter(q=>q.t<=ts+(e.horizonDays||7)*DAY))}:{};
  if(res){const pa=await pxAt(p,rts);o.result={ts:res.ts,pxShown:res.pxShown??null,pxActual:pa,actualMove:+pc(pa,r.px).toFixed(2)};
   if(res.pxShown){o.result.shownMove=e.pxShown?+pc(res.pxShown,e.pxShown).toFixed(2):null;o.result.pxDiff=+pc(pa,res.pxShown).toFixed(2);o.result.tsSuspect=Math.abs(o.result.pxDiff)>2;
    if(res.altTs)o.result.altDiff=+pc(await pxAt(p,T(res.altTs)),res.pxShown).toFixed(2)}}
  o.claims=(e.claims||[]).map(c=>claim(c,e,r,d,fc,rts,ts));
 }catch(x){o.error=String(x.message||x);o.optional=!!e.optional}
 return o}

export async function runDataset(ds,{onProgress,conc=3}={}){let n=0;return pool(ds.entries,conc,async e=>{const x=await runOne(e);onProgress&&onProgress(++n,ds.entries.length,e.id);return x})}

// Pembanding: jam acak (seed tetap) pada koin yang sama. v1 dan v4 memakai setup identik, jadi selisihnya murni dari aturan stop (berpasangan, tanpa derau setup).
export async function runBaseline(ds,{n=200,seed=7,from='2026-06-20',to='2026-09-28',days=7,conc=4,onProgress}={}){
 const syms=[...new Set(ds.entries.filter(e=>e.cls!=='invest'&&!e.pair&&!e.optional).map(e=>e.sym))];
 let s=seed;const rnd=()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
 const a=T(from),b=T(to),jobs=Array.from({length:n},()=>({sym:syms[Math.floor(rnd()*syms.length)],ts:Math.floor((a+rnd()*(b-a))/H1)*H1}));let k=0;
 return pool(jobs,conc,async j=>{const o={sym:j.sym,ts:new Date(j.ts).toISOString()};
  try{const p=j.sym+'USDT',{R}=await at(j.sym,p,j.ts),fc=R.v1.best?await fwd(p,j.ts,days):[];
   for(const v of['v1','v4']){const x=R[v].best;o[v]=x?{sim:sim(x,fc),side:x.side,kind:x.kind,tf:x.tf}:{}}}catch(x){o.error=String(x.message||x)}
  onProgress&&onProgress(++k,n,j.sym);return o})}

// par = trade yang terisi pada v1 dan v4 (setup sama): berapa yang hasilnya berbeda, siapa lebih baik, dan total selisih R.
export const bl2=bl=>{const ok=bl.filter(x=>!x.error),st=(L,k)=>simStats(L.map(x=>x[k]||{})),
 par=ok.filter(x=>x.v1&&x.v1.sim&&x.v1.sim.st!=='tidak terisi'&&x.v4&&x.v4.sim),dif=par.filter(x=>Math.abs(x.v4.sim.R-x.v1.sim.R)>1e-9),sum=a=>+a.reduce((s,v)=>s+v,0).toFixed(2);
 return{n:bl.length,v1:st(bl,'v1'),v4:st(bl,'v4'),
  par:{n:par.length,beda:dif.length,v4lebihBaik:dif.filter(x=>x.v4.sim.R>x.v1.sim.R).length,v4lebihBuruk:dif.filter(x=>x.v4.sim.R<x.v1.sim.R).length,
   selisihR:sum(dif.map(x=>x.v4.sim.R-x.v1.sim.R)),totalV1:sum(par.map(x=>x.v1.sim.R)),totalV4:sum(par.map(x=>x.v4.sim.R))}}};
// Median dan rata-rata tanpa trade terbaik, supaya satu trade besar tidak menipu rata-rata. minR = kerugian terburuk (di mode close bisa lebih dari 1R).
export const simStats=L=>{const S=L.filter(x=>x.sim),f=S.filter(x=>x.sim.st!=='tidak terisi'),R=f.map(x=>x.sim.R).sort((a,b)=>a-b),avg=a=>a.length?+(a.reduce((s,v)=>s+v,0)/a.length).toFixed(2):null;
 return{n:L.length,setup:S.length,terisi:f.length,win:f.filter(x=>x.sim.R>0).length,sl:f.filter(x=>x.sim.st==='SL').length,avgR:avg(R),tanpaTerbaik:avg(R.slice(0,-1)),medR:R.length?+R[Math.floor(R.length/2)].toFixed(2):null,minR:R.length?+R[0].toFixed(2):null}};

const core=L=>{const g=L.filter(x=>x.grade.verdict!=='dilewati'),c=k=>g.filter(x=>x.grade.verdict===k).length,lv=L.filter(x=>x.levels&&x.levels.total);
 return{dinilai:g.length,sama:c('sama'),sebagian:c('sebagian'),beda:c('beda')+c('berlawanan')+c('tidak terdeteksi'),
  skor:g.length?Math.round(g.reduce((s,x)=>s+({sama:1,sebagian:.5}[x.grade.verdict]||0),0)/g.length*100):null,
  levelHit:lv.reduce((s,x)=>s+x.levels.hit,0),levelTotal:lv.reduce((s,x)=>s+x.levels.total,0),sim:simStats(L)}};
export function summarize(res){const ok=res.filter(x=>!x.error),cl=ok.flatMap(x=>(x.claims||[]).filter(y=>!y.info&&!y.conditional));
 return{entri:res.length,error:res.filter(x=>x.error&&!x.optional).length,...core(ok),v4:{sim:simStats(ok.map(x=>x.v4||{}))},
  klaimOk:cl.filter(y=>y.verdict==='tercapai tepat waktu').length,klaimTotal:cl.length,
  waktuMencurigakan:ok.filter(x=>x.tsSuspect||x.result?.tsSuspect).map(x=>x.id)}}

if(typeof process!=='undefined'&&process.versions?.node&&/validate\.mjs$/.test(process.argv[1]||''))(async()=>{
 const fs=await import('node:fs/promises'),ds=JSON.parse(await fs.readFile(new URL('./eliz-dataset.json',import.meta.url),'utf8'));
 const res=await runDataset(ds,{onProgress:(i,n,id)=>process.stderr.write(`\r${i}/${n} ${id}        `)});
 console.log('\n'+res.map(x=>`${x.id.padEnd(15)}${x.cls.padEnd(10)}${(x.error?'ERROR '+x.error:x.grade.verdict).padEnd(20)}wick:${(x.sim?x.sim.st+' '+x.sim.R.toFixed(2):'-').padEnd(24)}close:${x.v4&&x.v4.sim?x.v4.sim.st+' '+x.v4.sim.R.toFixed(2):'-'}`).join('\n'));
 const sum=summarize(res);console.log(JSON.stringify(sum,null,1));let bl=null;
 if(process.argv.includes('--baseline')){bl=await runBaseline(ds,{onProgress:(i,n)=>process.stderr.write(`\rbaseline ${i}/${n}   `)});console.log('\nbaseline acak',JSON.stringify(bl2(bl),null,1))}
 await fs.writeFile('hasil-uji.json',JSON.stringify({res,summary:sum,baseline:bl},null,1));console.log('Tersimpan: hasil-uji.json')})();
