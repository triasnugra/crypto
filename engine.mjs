// asgracrypto: mesin aturan CryptoEliz. Level berupa kotak di tepi range, sweep lalu reclaim lalu retest, Monday Range.
const HOSTS=['https://data-api.binance.vision','https://api.binance.com','https://api1.binance.com','https://api2.binance.com'];
let hi=0;
export async function bj(p){let e;for(let t=0;t<HOSTS.length;t++){const h=HOSTS[(hi+t)%HOSTS.length];
 try{const r=await fetch(h+'/api/v3/'+p,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(h+' HTTP '+r.status);hi=(hi+t)%HOSTS.length;return await r.json()}catch(x){e=x}}throw e}
export const kl=async(s,iv,lim)=>(await bj(`klines?symbol=${s}&interval=${iv}&limit=${lim}`)).map(a=>({t:a[0],o:+a[1],h:+a[2],l:+a[3],c:+a[4],v:+a[5]}));
export const NOT=/^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|AEUR|USD1|XUSD|PAXG|USDE|PYUSD|U|USDS|USDD|RLUSD|BFUSD|USDG)$/;
export const fmt=v=>v>=100?v.toFixed(1):v>=1?v.toFixed(3):v.toPrecision(3);
// Tanggal keputusan FOMC 2026 (hari ke-2). Verifikasi di federalreserve.gov
const FOMC=['2026-01-28','2026-03-18','2026-04-29','2026-06-17','2026-07-29','2026-09-16','2026-10-28','2026-12-09'];
const HOL=['12-24','12-25','12-26','12-31','01-01'];
const CF={f4:{tf:'4H',look:126,skip:6,rec:6,k:3,bo:12,mon:1,minRg:.04},d1:{tf:'1D',look:120,skip:5,rec:5,k:3,bo:10,mon:0,minRg:.08}};
const MREC=12; // sapuan Monday dianggap baru bila terjadi dalam 12 candle 4H (48 jam) terakhir
const atr=(b,n=14)=>b.slice(-n).reduce((s,q,i,a)=>s+Math.max(q.h-q.l,i?Math.abs(q.h-a[i-1].c):0,i?Math.abs(q.l-a[i-1].c):0),0)/n;
const piv=(b,k,from,to,key,up)=>{const r=[];for(let i=Math.max(k,from);i<to;i++){let ok=true;for(let j=i-k;j<=i+k&&ok;j++)if(j!==i&&b[j]&&(up?b[j][key]>b[i][key]:b[j][key]<b[i][key]))ok=false;if(ok)r.push(i)}return r};
// Weekly dari candle harian (minggu mulai Senin UTC), lalu kotak S/R: pivot weekly yang dihormati berulang kali
function weekly(d){const W=[];for(const q of d){const k=Math.floor((q.t/864e5+3)/7),x=W.at(-1);if(x&&x.k===k){x.h=Math.max(x.h,q.h);x.l=Math.min(x.l,q.l);x.c=q.c;x.v+=q.v}else W.push({k,t:q.t,o:q.o,h:q.h,l:q.l,c:q.c,v:q.v})}return W}
function keyLevels(d,px){const W=weekly(d).slice(0,-1),n=W.length;if(n<20)return null;
 const P=[...piv(W,2,0,n-2,'h',1).map(i=>W[i].h),...piv(W,2,0,n-2,'l',0).map(i=>W[i].l)].sort((a,b)=>a-b),C=[];
 for(const v of P){const c=C.at(-1);if(c&&v<=c.lo*1.04){c.hi=v;c.n++;c.s+=v}else C.push({lo:v,hi:v,n:1,s:v})}
 const Z=C.filter(c=>c.n>=2).map(c=>({lo:c.lo,hi:c.hi,m:c.s/c.n,n:c.n})),
 sup=Z.filter(z=>z.m>px*1.005).sort((a,b)=>a.m-b.m)[0]||null,dem=Z.filter(z=>z.m<px*.995).sort((a,b)=>b.m-a.m)[0]||null,r=W.slice(-52);
 return{sup,dem,H:Math.max(...r.map(q=>q.h)),L:Math.min(...r.map(q=>q.l)),n:Z.length}}
// struktur harian tanpa indikator: HH+HL = naik, LH+LL = turun
function bias(b){const n=b.length,H=piv(b,3,n-120,n-3,'h',1),L=piv(b,3,n-120,n-3,'l',0);if(H.length<2||L.length<2)return 0;
 const hh=b[H.at(-1)].h>b[H.at(-2)].h,hl=b[L.at(-1)].l>b[L.at(-2)].l;return hh&&hl?1:!hh&&!hl?-1:0}

function frame(b0,px,C,bs,lg,tlbOn){
 const b=b0.slice(0,-1),n=b.length;if(n<C.look+10)return null;
 const{look,skip,rec,k,bo}=C,rb=b.slice(n-look,n-skip),H=Math.max(...rb.map(q=>q.h)),L=Math.min(...rb.map(q=>q.l)),rg=H-L;
 if(!(rg>0))return null;
 const M=(H+L)/2,A=atr(b),bd=Math.min(.5*A,rg/4),pos=(px-L)/rg,midBig=pos>.3&&pos<.7,flat=rg/L<C.minRg;
 const R=b.slice(n-rec),last=b[n-1],lowW=Math.min(...R.map(q=>q.l)),highW=Math.max(...R.map(q=>q.h));
 const sUp=lowW<L&&px>L&&last.c>L,sDn=highW>H&&px<H&&last.c<H;
 const PH=piv(b,k,n-look,n-skip,'h',1),PL=piv(b,k,n-look,n-skip,'l',0);
 const tL=PL.filter(i=>b[i].l<=L+bd).length,tH=PH.filter(i=>b[i].h>=H-bd).length;
 // Double Deviation: 2 sweep, sweep ke-2 lebih dangkal, keduanya reclaim
 const W=Math.round(look*1.2),Zs=Math.min(...b.slice(n-W).map(q=>q.c)),Zh=Math.max(...b.slice(n-W).map(q=>q.c));
 const sw=(z,up)=>{const S=[];for(let i=n-W;i<n;i++){const q=b[i];if(up?q.l<z*.998&&q.c>z:q.h>z*1.002&&q.c<z)if(!S.length||i-S.at(-1)>=3)S.push(i)}return S};
 const sU=sw(Zs,1),sD=sw(Zh,0);
 const ddUp=sU.length>=2&&sU.at(-1)>=n-rec*2&&b[sU.at(-1)].l>b[sU.at(-2)].l&&px>Zs,ddDn=sD.length>=2&&sD.at(-1)>=n-rec*2&&b[sD.at(-1)].h<b[sD.at(-2)].h&&px<Zh;
 // Wolf: breakout/breakdown trendline (2 pivot terakhir) yang gagal
 const tl=(P,key,desc)=>{if(P.length<2)return null;const a=P.at(-2),c=P.at(-1);if(c-a<5||(desc?b[c][key]>=b[a][key]:b[c][key]<=b[a][key]))return null;return{a,av:b[a][key],sl:(b[c][key]-b[a][key])/(c-a),e:n}};
 const TH=tl(PH,'h',1),TL=tl(PL,'l',0),ln=(T,i)=>T.av+T.sl*(i-T.a);
 const brk=(T,key,up)=>!!T&&R.some((q,j)=>up?q.h>ln(T,n-rec+j):q.l<ln(T,n-rec+j));
 const wDn=brk(TH,'h',1)&&px<ln(TH,n)&&last.c<ln(TH,n-1),wUp=brk(TL,'l',0)&&px>ln(TL,n)&&last.c>ln(TL,n-1);
 // Breakout/breakdown dengan acceptance (2+ close) lalu harga kembali me-retest level
 const BR=b.slice(n-bo),boUp=BR.filter(q=>q.c>H).length>=2&&px>=H-bd&&px<=H+1.5*bd,boDn=BR.filter(q=>q.c<L).length>=2&&px<=L+bd&&px>=L-1.5*bd;

 // Breakout trendline (bukan Wolf yang gagal). Default MATI (ctx.tlb): hasil uji menunjukkan versi awal merugikan.
 // Syarat: 2+ close melewati garis, break baru (<8 candle), entry limit di garis maksimal 2,5% dari harga, dan retest NYATA:
 // setelah candle break, harga pernah kembali ke dalam 0,5 ATR dari garis (atau sedang berada di sana).
 const tb=(T,up)=>{if(lg||!tlbOn||!T)return false;const j=[];for(let i=n-8;i<n;i++)j.push(up?b[i].c>ln(T,i):b[i].c<ln(T,i));let q=7;while(q>=0&&j[q])q--;
  if(q<0||7-q<2)return false;
  const L0=ln(T,n),g=up?px-L0:L0-px;if(g<-.5*bd||g>1.5*A||Math.abs(L0-px)/px>.025)return false;
  for(let i=n-8+q+2;i<n;i++){const l0=ln(T,i);if(up?b[i].l<=l0+.5*A:b[i].h>=l0-.5*A)return true}
  return g<=.5*A};
 const tbUp=tb(TH,1),tbDn=tb(TL,0);
 // Monday Range (hanya 4H): sweep Monday Low/High setelah Senin selesai
 let mon=null,mUp=false,mDn=false;
 if(C.mon){let mi=-1;for(let i=b0.length-1;i>=Math.max(0,b0.length-60);i--)if(new Date(b0[i].t).getUTCDay()===1){mi=i;break}
  if(mi>=0){let s=mi;while(s>0&&new Date(b0[s-1].t).getUTCDay()===1)s--;const MB=b0.slice(s,mi+1),aft=b0.slice(mi+1);
   mon={h:Math.max(...MB.map(q=>q.h)),l:Math.min(...MB.map(q=>q.l)),done:aft.length>0};
   if(mon.done){const rc=lg?aft:aft.slice(-MREC);mUp=rc.some(q=>q.l<mon.l)&&px>mon.l&&last.c>mon.l;mDn=rc.some(q=>q.h>mon.h)&&px<mon.h&&last.c<mon.h;mon.aft=rc}}}
 // tengah range diukur terhadap Monday Range bila sudah terbentuk (minimal lebar 1,2%), kalau tidak terhadap range 21 hari
 let mid=midBig;if(!lg&&mon&&mon.done&&(mon.h-mon.l)/mon.l>=.012){const pm=(px-mon.l)/(mon.h-mon.l);mid=pm>.3&&pm<.7}
 const S=[],add=(kind,side,why,lvl,sl0,sc)=>S.push({kind,side,why,lvl,sl0,sc:sc+(bs===side?1:0)+(side==1?px>M:px<M)*1,tf:C.tf});
 if(!flat){
  if(ddUp)add('dd',1,'Double Deviation: sweep ke-2 lebih dangkal, tekanan jual melemah',Zs,b[sU.at(-1)].l,4);
  if(ddDn)add('dd',-1,'Double Deviation: sweep ke-2 lebih dangkal, tekanan beli melemah',Zh,b[sD.at(-1)].h,4);
  if(sUp)add(tL>=2?'tap':'dev',1,tL>=2?'Three Tap: 2 sentuhan, lalu sweep dan reclaim':'Sweep di bawah range, lalu reclaim',L,lowW,tL>=2?3:2);
  if(sDn)add(tH>=2?'tap':'dev',-1,tH>=2?'Three Top: 2 sentuhan, lalu sweep dan reclaim':'Sweep di atas range, lalu kembali masuk',H,highW,tH>=2?3:2);
  if(mUp)add('mon',1,'Sweep Monday Low, lalu reclaim',mon.l,Math.min(...mon.aft.map(q=>q.l)),2);
  if(mDn)add('mon',-1,'Sweep Monday High, lalu kembali masuk',mon.h,Math.max(...mon.aft.map(q=>q.h)),2);
  if(wUp)add('wolf',1,'Wolf bullish: breakdown trendline gagal',ln(TL,n),lowW,1);
  if(wDn)add('wolf',-1,'Wolf bearish: breakout trendline gagal',ln(TH,n),highW,1);
  if(tbUp)add('tlb',1,'Breakout trendline turun: 2+ close di atas garis, retest garis',ln(TH,n),Math.min(...b.slice(n-6).map(q=>q.l)),1);
  if(tbDn)add('tlb',-1,'Breakdown trendline naik: 2+ close di bawah garis, retest gagal',ln(TL,n),Math.max(...b.slice(n-6).map(q=>q.h)),1);
  if(boUp&&bs>=0)add('bo',1,'Breakout dengan acceptance, retest level',H,Math.min(...b.slice(n-4).map(q=>q.l)),1);
  if(boDn&&bs<=0)add('bo',-1,'Breakdown, retest gagal (failed reclaim)',L,Math.max(...b.slice(n-4).map(q=>q.h)),1);
  if(!sUp&&bs==1&&tL>=2&&px>=L&&px<=L+1.5*bd)add('zone',1,'Retest zona demand kuat (2+ sentuhan, searah struktur)',L+bd,L,1);
  if(!sDn&&bs==-1&&tH>=2&&px<=H&&px>=H-1.5*bd)add('zone',-1,'Retest zona supply kuat (2+ sentuhan, searah struktur)',H-bd,H,1)}
 // di tengah range hanya pemicu sweep yang dipertahankan
 const keep=S.filter(s=>!(mid&&['bo','zone','wolf','tlb'].includes(s.kind)));
 const tags=[];if(sUp)tags.push(tL>=2?'Three Tap':'Sweep bawah');if(sDn)tags.push(tH>=2?'Three Top':'Sweep atas');if(ddUp||ddDn)tags.push('Double Deviation');
 if(mUp)tags.push('Sweep Monday Low');if(mDn)tags.push('Sweep Monday High');if(wUp||wDn)tags.push('Wolf');if(tbUp||tbDn)tags.push('Breakout trendline');if(boUp||boDn)tags.push('Breakout retest');
 return{tf:C.tf,H,L,M,A,bd,pos,mid,flat,mon,tags,S:keep,tl:wDn?TH:wUp?TL:null}}

function confirm(sd,entry,sl,b){
 const g=[];for(const q of b){const k=Math.floor(q.t/432e5),x=g.at(-1);if(x&&x.k===k){x.c=q.c;x.n++}else g.push({k,c:q.c,n:1})}
 if(g.length&&g.at(-1).n<3)g.pop();
 const c12=g.at(-1)?.c,c4=b.at(-1).c;
 if(c12!=null&&(sd==1?c12<sl:c12>sl))return['bad','Batal: close 12H melewati SL'];
 const held=b.slice(-8).some(q=>sd==1?q.l<=entry*1.003&&q.c>entry:q.h>=entry*.997&&q.c<entry);
 if(sd==1?c4>entry:c4<entry)return held?['ok','Retest tertahan di 4H']:['wait','Di sisi benar level, belum retest'];
 return['wait','Tunggu close 4H '+(sd==1?'di atas':'di bawah')+' level']}

function mkPlan(s,fr,px,htf,b4){
 const A=fr.A,sd=s.side,rg=fr.H-fr.L;
 const entry=sd==1?Math.min(s.lvl,px):Math.max(s.lvl,px);
 let sl=sd==1?s.sl0-.25*A:s.sl0+.25*A;const minR=Math.max(.01*entry,.8*A);sl=sd==1?Math.min(sl,entry-minR):Math.max(sl,entry+minR); // SL minimal: 1% atau 0.8 ATR agar noise tidak menyapunya
 const risk=Math.abs(entry-sl),slp=risk/entry*100;
 const T=s.kind==='bo'?[[sd==1?fr.H+.25*rg:fr.L-.25*rg,'TP1'],[sd==1?fr.H+.5*rg:fr.L-.5*rg,'TP2']]:[[fr.M,'TP1 garis tengah'],[sd==1?fr.H:fr.L,'TP2 tepi range']];
 const tg=T.filter(t=>sd*(t[0]-entry)>=.5*risk).map(t=>({v:t[0],l:t[1]}));
 const rr=tg.length?Math.abs(tg.at(-1).v-entry)/risk:0;
 const hz=htf&&(sd==1?htf.sup.a:htf.dem.b);if(hz&&tg.length&&sd*(hz-tg.at(-1).v)>0)tg.push({v:hz,l:'TP3 box HTF'});
 const cf=confirm(sd,entry,sl,b4);if(cf[0]==='bad')return null;
 const type=rr<1.5?'ditolak':slp<=5?'scalping':slp<=15?'swing':slp<=30&&rr>=3?'spot (SL lebar)':'ditolak';
 return{...s,entry,sl,risk,slp,tg,rr,type,cf,dist:Math.abs(px-entry)/px*100}}

export function analyze(sym,d,f,ctx={}){
 const px=f.at(-1).c,dd=d.slice(0,-1),bs=bias(dd);
 const lg=!!ctx.legacy,tlbOn=!!ctx.tlb,f4=frame(f,px,CF.f4,bs,lg,tlbOn),f1=frame(d,px,CF.d1,bs,lg,tlbOn);
 if(!f4&&!f1)throw new Error('data tidak cukup');
 const htf=f1?{sup:{a:f1.H-f1.bd,b:f1.H},dem:{a:f1.L,b:f1.L+f1.bd}}:null,b4=f.slice(0,-1),setups=[];
 for(const fr of[f4,f1])if(fr)for(const s of fr.S){const p=mkPlan(s,fr,px,htf,b4);if(!p||p.type==='ditolak')continue;
  p.w=[];if(p.type.startsWith('spot'))p.w.push('SL lebar: hanya untuk spot tanpa leverage');
  if(p.side==1&&ctx.btcBias==-1)p.w.push('Melawan struktur turun BTC');if(!lg&&bs&&p.side===-bs)p.w.push('Melawan struktur harian');if(ctx.qv<2e7)p.w.push('Volume 24 jam rendah, risiko slip');setups.push(p)}
 setups.sort((a,b)=>b.sc-a.sc||a.dist-b.dist);
 const fr=f4||f1,st=setups.length?'Setup aktif':fr.flat?'Harga datar':fr.mid?'Tengah range: tanpa trade':fr.pos<.2?'Dekat low: tunggu sweep dan reclaim':fr.pos>.8?'Dekat high: tunggu sweep atau breakout dan retest':'Belum ada pemicu';
 return{s:sym,px,qv:ctx.qv||0,bias:bs,f4,f1,htf,wk:lg?null:keyLevels(d,px),setups,best:setups[0]||null,st,ret30:px/dd[dd.length-30].c-1,
  ch4:f.slice(-120),off4:f.length-120,ch1:d.slice(-90),off1:d.length-90}}

export function alertList(){const d=new Date(),iso=d.toISOString().slice(0,10),md=iso.slice(5),dw=d.getUTCDay(),tm=new Date(+d+864e5),A=[];
 if(FOMC.includes(iso)||FOMC.includes(tm.toISOString().slice(0,10)))A.push(['y','FOMC hari ini atau besok. Eliz menganggap berita sebagai noise: tetap tunggu pemicu dan pakai SL ketat.','Verifikasi tanggal di federalreserve.gov']);
 if(tm.getUTCMonth()!=d.getUTCMonth())A.push(['y','Hari terakhir bulan. Penutupan bulanan 00:00 UTC.','']);
 if(dw==0)A.push(['y','Menjelang penutupan weekly (Senin 00:00 UTC).','']);
 if(HOL.includes(md))A.push(['r','Libur panjang, volume tipis. Banyak bot dan flash dump.','']);
 if(dw==1)A.push(['y','Hari Senin: tunggu Monday Range terbentuk dan close Senin sebelum mencari pemicu baru.','']);
 return A}
