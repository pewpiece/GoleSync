"""The laptop-side web page (loopback only): pairing QR, send to phone, history, kill switch."""

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GoleSync</title>
<style>
:root{color-scheme:dark;--bg:#0B1220;--card:#111a2e;--fg:#e6edf7;--mut:#8aa0bd;--acc:#38BDF8;--bad:#f87171}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
main{max-width:880px;margin:0 auto;padding:24px 16px;display:grid;gap:16px}
h1{margin:0;font-size:24px}h1 span{color:var(--acc)}h2{margin:0 0 8px;font-size:16px;color:var(--mut);font-weight:600}
.card{background:var(--card);border-radius:12px;padding:16px}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}
img.qr{width:220px;height:220px;background:#fff;border-radius:8px;padding:6px}
textarea{width:100%;min-height:90px;background:#0B1220;color:var(--fg);border:1px solid #243452;border-radius:8px;padding:10px;font:inherit}
button{background:var(--acc);color:#04202e;border:0;border-radius:8px;padding:9px 16px;font:inherit;font-weight:600;cursor:pointer}
button.bad{background:var(--bad);color:#2a0606}button.ghost{background:#1b2742;color:var(--fg)}
ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}li{background:#0B1220;border-radius:8px;padding:8px 10px;overflow-wrap:anywhere}
small{color:var(--mut)}.pill{padding:2px 8px;border-radius:99px;background:#1b2742;font-size:12px}
</style></head><body><main>
<h1><span>G</span>oleSync <small id="stat"></small></h1>
<div class="card"><h2>Pair your phone</h2><div class="row">
<img class="qr" src="/local/pair.svg" alt="Pairing QR code">
<div><p>Open GoleSync on your phone and scan this code. It contains your laptop's address and secret token: do not share it or screenshot it.</p>
<p><button id="kill"></button> <small>Kill switch: ignore all remote-control and command events.</small></p></div></div></div>
<div class="card"><h2>Send to phone</h2>
<textarea id="t" placeholder="Text or link to send to your phone's Inbox"></textarea>
<p><button id="sendt">Send text</button> &nbsp; <input type="file" id="f"> <button class="ghost" id="sendf">Send file</button> <small id="msg"></small></p></div>
<div class="card"><h2>History</h2><ul id="h"></ul></div>
</main>
<script>
const H={'X-GoleSync-Local':'1'};let paused=false;
const $=id=>document.getElementById(id);
function say(m){$('msg').textContent=m;setTimeout(()=>$('msg').textContent='',4000)}
async function refresh(){
  const s=await (await fetch('/local/state')).json();paused=s.paused;
  $('stat').textContent=s.clients+' phone(s) connected'+(paused?' - PAUSED':'');
  $('kill').textContent=paused?'Resume remote control':'Pause remote control';$('kill').className=paused?'':'bad';
  const ul=$('h');ul.textContent='';
  for(const i of s.history){const li=document.createElement('li');
    const tag=document.createElement('span');tag.className='pill';tag.textContent=i.direction==='to_phone'?'to phone':'from phone';
    li.append(tag,' ',i.kind==='file'?(i.filename+' ('+Math.round((i.size||0)/1024)+' KB)'):i.text);ul.append(li)}
}
$('kill').onclick=async()=>{await fetch('/local/'+(paused?'resume':'pause'),{method:'POST',headers:H});refresh()};
$('sendt').onclick=async()=>{const text=$('t').value;if(!text)return;
  const r=await fetch('/local/send',{method:'POST',headers:{...H,'Content-Type':'application/json'},body:JSON.stringify({text})});
  if(r.ok){$('t').value='';say('Sent')}else say('Failed: '+r.status);refresh()};
$('sendf').onclick=async()=>{const f=$('f').files[0];if(!f)return;
  const r=await fetch('/local/send-file?name='+encodeURIComponent(f.name),{method:'POST',headers:H,body:f});
  say(r.ok?'Sent':'Failed: '+r.status);refresh()};
refresh();setInterval(refresh,4000);
</script></body></html>"""
