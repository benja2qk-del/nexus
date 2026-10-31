// Issue a one-time pairing code for a phone, list paired devices, or revoke one. Runs on the PC only.
//   node tools/pair.mjs            -> new code (valid 10 minutes, single use)
//   node tools/pair.mjs list       -> paired devices
//   node tools/pair.mjs revoke ID  -> remove a device (ID prefix from the list)
const port = Number(process.env.NEXUS_PORT) || 4777;
const base = `http://127.0.0.1:${port}`;
const [cmd, arg] = process.argv.slice(2);

if (cmd === 'list') {
  const r = await fetch(base + '/api/devices');
  console.log(JSON.stringify((await r.json()).devices, null, 2));
} else if (cmd === 'revoke') {
  const { revoke } = await import('../auth.js');
  console.log(revoke(String(arg || '')) ? 'revoked (restart NEXUS to apply)' : 'no such device');
} else {
  const r = await fetch(base + '/api/pair/new', { method: 'POST', headers: { 'X-Nexus': '1' } });
  const j = await r.json();
  if (!r.ok) { console.error(j.error || r.status); process.exit(1); }
  console.log(`${j.code}  (valid until ${new Date(j.expiresAt).toLocaleTimeString()})`);
}
