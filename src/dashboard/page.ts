// Single-file dashboard page (no external scripts, works offline behind an SSH tunnel).
export const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BNB Edge Bot</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#16181d;--mute:#6a7180;--line:#e3e6eb;--good:#0f7b4f;--bad:#c0362c;--warn:#a86400;--accent:#2f5bd3}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--ink:#e8eaee;--mute:#9098a6;--line:#2a2f3a;--good:#3fbf86;--bad:#ef6b5f;--warn:#e0a03a;--accent:#7b9bff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1180px;margin:0 auto;padding:16px}
header{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:14px}
h1{font-size:18px;margin:0}h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--mute);margin:0 0 8px}
.pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:12px;font-weight:600;border:1px solid var(--line)}
.paper{color:var(--accent)}.live{color:var(--bad);border-color:var(--bad)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;min-width:0}
.k{font-size:12px;color:var(--mute)}.v{font-size:20px;font-weight:650;font-variant-numeric:tabular-nums}
.good{color:var(--good)}.bad{color:var(--bad)}.warnc{color:var(--warn)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}@media(max-width:800px){.two{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:5px 6px;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--mute);font-weight:500}td.n{text-align:right;font-variant-numeric:tabular-nums}.scroll{overflow-x:auto}
button{font:inherit;padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
button.danger{border-color:var(--bad);color:var(--bad)}input{font:inherit;padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink)}
svg{width:100%;height:120px;display:block}ul{margin:0;padding-left:18px}.small{font-size:12px;color:var(--mute)}
</style></head><body><main>
<header><div><h1>BNB Edge Bot <span id="mode" class="pill">…</span> <span id="kill" class="pill"></span></h1><div class="small" id="sub"></div></div>
<div><input id="tok" type="password" placeholder="dashboard token" size="18"> <button id="save">Save</button> <button class="danger" id="killbtn">Kill switch</button> <button id="resumebtn">Resume</button></div></header>
<div class="grid" id="kpis"></div>
<div class="two"><div class="card"><h2>Equity (wallet + open value, BNB)</h2><svg id="eq" viewBox="0 0 600 120" preserveAspectRatio="none"></svg></div>
<div class="card"><h2>Evidence gate for live trading</h2><div id="gate"></div></div></div>
<div class="card" style="margin-bottom:12px"><h2>Open positions</h2><div class="scroll" id="open"></div></div>
<div class="two"><div class="card"><h2>Recent trades</h2><div class="scroll" id="trades"></div></div><div class="card"><h2>Recent decisions</h2><div class="scroll" id="dec"></div></div></div>
<div class="two"><div class="card"><h2>Markets</h2><div class="scroll" id="mk"></div></div><div class="card"><h2>Infrastructure &amp; research</h2><div id="infra"></div></div></div>
<p class="small">Read-only view plus kill switch. Not financial advice. Past and simulated results do not predict future results.</p>
</main><script>
const $=id=>document.getElementById(id);const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let token='';try{token=sessionStorage.getItem('t')||''}catch(e){}
$('tok').value=token;$('save').onclick=()=>{token=$('tok').value;try{sessionStorage.setItem('t',token)}catch(e){};load()};
const hdr=()=>({authorization:'Bearer '+token});
$('killbtn').onclick=async()=>{if(confirm('Turn on the kill switch? Open positions will be closed and no new entries made.')){await fetch('/api/kill',{method:'POST',headers:hdr()});load()}};
$('resumebtn').onclick=async()=>{await fetch('/api/resume',{method:'POST',headers:hdr()});load()};
const f=(x,d=5)=>x==null||!isFinite(x)?'–':Number(x).toFixed(d);const cls=x=>x>0?'good':x<0?'bad':'';
const tbl=(cols,rows)=>rows.length?'<table><tr>'+cols.map(c=>'<th>'+c[0]+'</th>').join('')+'</tr>'+rows.map(r=>'<tr>'+cols.map(c=>{const v=c[1](r);return '<td'+(c[2]?' class="n '+(c[3]?cls(c[3](r)):'')+'"':'')+'>'+v+'</td>'}).join('')+'</tr>').join('')+'</table>':'<span class="small">none</span>';
const time=t=>t?new Date(t*1000).toLocaleString():'–';
async function load(){const r=await fetch('/api/state',{headers:hdr()});if(r.status===401){$('sub').textContent='Enter the dashboard token.';return}const s=await r.json();
$('mode').textContent=s.mode.toUpperCase();$('mode').className='pill '+s.mode;$('kill').textContent=s.killSwitch?'KILL SWITCH ON':(s.status.paused?'PAUSED: '+s.status.pauseReason:'running');$('kill').className='pill '+(s.killSwitch||s.status.paused?'bad':'good');
$('sub').textContent='Last tick '+new Date(s.status.lastTickAt).toLocaleTimeString()+' · '+s.status.lastTickMs+' ms · gas '+f(s.status.gasGwei,3)+' gwei · errors '+s.status.errors;
const m=s.metrics;const k=[['Net PnL (BNB)',f(m.netPnlBnb),cls(m.netPnlBnb)],['Trades',m.trades],['Win rate',f(m.winRatePct,1)+'%'],['Expectancy/trade',f(m.expectancyPct,2)+'%',cls(m.expectancyPct)],['Profit factor',f(m.profitFactor,2)],['Max drawdown',f(m.maxDrawdownBnb)+' BNB'],['Risk of ruin',f(m.riskOfRuinPct,1)+'%'],['Open positions',s.open.length]];
$('kpis').innerHTML=k.map(x=>'<div class="card"><div class="k">'+x[0]+'</div><div class="v '+(x[2]||'')+'">'+x[1]+'</div></div>').join('');
const e=s.equity.map(x=>x.wallet_bnb+x.open_value_bnb);if(e.length>1){const lo=Math.min(...e),hi=Math.max(...e),sp=hi-lo||1;$('eq').innerHTML='<polyline fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" points="'+e.map((v,i)=>(i/(e.length-1)*600).toFixed(1)+','+(115-(v-lo)/sp*110).toFixed(1)).join(' ')+'"/>'}else $('eq').innerHTML='<text x="10" y="60" fill="var(--mute)" font-size="13">collecting…</text>';
$('gate').innerHTML=(s.gate.pass?'<b class="good">PASS</b>':'<b class="bad">NOT PASSED</b> (live trading refused)')+(s.gate.reasons.length?'<ul>'+s.gate.reasons.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'');
$('open').innerHTML=tbl([['Token',r=>esc(r.symbol)],['Strategy',r=>esc(r.strategy)],['Since',r=>time(r.entry_time)],['Size BNB',r=>f(r.size_bnb),1],['Remaining',r=>f(r.remaining_frac*100,0)+'%',1],['Realized',r=>f(r.realized_bnb),1]],s.open);
$('trades').innerHTML=tbl([['Exit',r=>time(r.exitTime)],['Token',r=>esc(r.token.slice(0,8))],['Reason',r=>esc(r.exitReason)],['PnL BNB',r=>f(r.pnlBnb),1,r=>r.pnlBnb],['%',r=>f(r.returnPct,2),1,r=>r.returnPct]],s.recentTrades);
$('dec').innerHTML=tbl([['Time',r=>new Date(r.ts).toLocaleTimeString()],['Token',r=>esc(r.symbol)],['Action',r=>esc(r.action)],['Why',r=>esc(String(r.reasons).slice(0,60))]],s.decisions);
$('mk').innerHTML=tbl([['Token',r=>esc(r.symbol)],['Venue',r=>esc(r.venue)+' '+r.feeBps+'bp'],['Bars',r=>r.bars,1],['Safety',r=>r.safety?(r.safety.pass?'<span class="good">pass '+r.safety.score+'</span>':'<span class="bad">'+esc(r.safety.reasons.slice(0,2).join(', '))+'</span>'):'–']],s.markets);
const rs=s.research;$('infra').innerHTML='<table><tr><td>RPC</td><td>'+(s.rpc.healthy?'<span class="good">healthy</span>':'<span class="bad">unhealthy</span>')+' · block '+esc(s.rpc.lastBlock)+'</td></tr><tr><td>WebSocket</td><td>'+esc(s.rpc.wsUrl||'none')+' · reconnects '+s.rpc.wsReconnects+'</td></tr><tr><td>Four.meme launches seen</td><td>'+(rs.launches.n||0)+' (buys '+(rs.launches.buys||0)+', sells '+(rs.launches.sells||0)+')</td></tr><tr><td>Graduations seen</td><td>'+(rs.graduations.n||0)+'</td></tr></table>';}
load();setInterval(load,10000);
</script></body></html>`;
