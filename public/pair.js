'use strict';
// Pairing page: trades the one-time code from the PC for this device's long-lived NEXUS cookie.
const code = document.getElementById('code');
const msg = document.getElementById('msg');
const go = document.getElementById('go');
// QR codes carry the short-lived code only in the fragment, never a server log or referrer.
const scannedCode=new URLSearchParams(location.hash.slice(1)).get('code');
if(scannedCode&&/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(scannedCode)){code.value=scannedCode;history.replaceState(null,'',location.pathname);}
function paintCode(){const raw=code.value.replace(/[^A-Z0-9]/gi,'').toUpperCase();document.querySelectorAll('.pair-code-tiles span').forEach((el,i)=>el.textContent=raw[i]||'');}
paintCode();

// Keep the XXXX-XXXX shape while typing.
code.addEventListener('input', () => {
  const raw = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  code.value = raw.length > 4 ? raw.slice(0, 4) + '-' + raw.slice(4) : raw;
  paintCode();
  code.setAttribute('aria-invalid','false');msg.className='msg';msg.textContent='Or scan the QR code with the Camera app.';
});

document.getElementById('pair').addEventListener('submit', async e => {
  e.preventDefault();
  if (go.disabled) return;
  paintCode();
  msg.className = 'msg'; msg.textContent = 'Pairing…'; go.disabled = true;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch('/api/pair', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nexus': '1' },
      body: JSON.stringify({ code: code.value, name: document.getElementById('name').value }),
      signal: controller.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || (r.status === 403 ? 'Connect with the owner’s Tailscale account, then try again.' : 'Pairing failed.'));
    document.getElementById('pair').hidden=true;
    const success=document.getElementById('pairSuccess');success.hidden=false;success.querySelector('a').focus();
  } catch (err) {
    msg.className = 'msg bad'; msg.textContent = err.name === 'AbortError' ? 'Connection timed out. Check your connection and try again.' : /wrong|expired/.test(err.message)?"That code didn't match or has expired. Check the PC screen, or get a new code there.":err.message;code.setAttribute('aria-invalid','true');go.disabled = false;code.focus();
  } finally { clearTimeout(timer); }
});
