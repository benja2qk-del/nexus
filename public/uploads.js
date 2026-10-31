// Attachment state belongs to a draft, never to whichever session is currently visible.
// A file dropped outside the composer must not replace NEXUS with the file itself.
for (const type of ['dragover', 'drop']) window.addEventListener(type, e => { if (Array.from(e.dataTransfer?.types || []).includes('Files') && !e.defaultPrevented) { e.preventDefault(); if (type === 'dragover') e.dataTransfer.dropEffect = 'none'; } });
const attachments = (() => {
  const drafts = new Map(), maxFile = 50 * 1024 * 1024;
  let serial = 0, newKey = null;
  const clip = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9a7 7 0 0 1 10 10l-9 9"/></svg>';
  const size = n => n >= 1024 * 1024 ? (n / (1024 * 1024)).toFixed(1) + ' MB' : n >= 1024 ? Math.ceil(n / 1024) + ' KB' : n + ' B';
  const ref = (path, kind) => kind !== 'claude' ? path : '@"' + path + '"';
  const blocked = key => !!drafts.get(key)?.items.some(f => f.status !== 'done');
  const editable = d => !d.canEdit || d.canEdit();
  const quote = p => /\s/.test(p) ? '"' + p + '"' : p;
  const hasFiles = dt => Array.from(dt?.types || []).includes('Files');
  // A screenshot arrives as "image.png"; it gets the time it was pasted so several stay apart.
  const pasted = f => {
    if (f.name && !/^image\.\w+$/i.test(f.name)) return f;
    const t = new Date(), p = n => String(n).padStart(2, '0'), ext = (f.type.split('/')[1] || 'png').replace(/\W.*/, '').replace('jpeg', 'jpg');
    return new File([f], `Pasted image ${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}.${ext}`, { type: f.type, lastModified: f.lastModified });
  };
  const fromUri = uri => {
    try { const u = new URL(uri); if (u.protocol !== 'file:') return ''; const p = decodeURIComponent(u.pathname); return /^\/[A-Za-z]:/.test(p) ? p.slice(1).replace(/\//g, '\\') : u.host ? '\\\\' + u.host + p.replace(/\//g, '\\') : p; } catch { return ''; }
  };
  function render(d) {
    if (!d.host?.isConnected || d.host.dataset.attachKey !== d.key) return;
    const disabled = !editable(d);
    const list = d.host.querySelector('.attachment-list');
    for (const chip of [...list.children]) if (!d.items.some(f => f.id === chip.dataset.file)) chip.remove();
    for (const f of d.items) {
      let chip = list.querySelector(`[data-file="${f.id}"]`);
      if (!chip) {
        chip = document.createElement('li'); chip.dataset.file = f.id;
        chip.innerHTML = '<span class="attachment-symbol" aria-hidden="true"></span><span class="attachment-detail"><strong></strong><small></small><progress max="100"></progress></span><button type="button" class="attachment-remove">&times;</button>';
        list.appendChild(chip);
      }
      chip.className = 'attachment-chip ' + f.status;
      chip.querySelector('.attachment-symbol').textContent = f.status === 'done' ? '✓' : f.status === 'error' ? '!' : '↑';
      const label = chip.querySelector('strong'); label.textContent = f.name; label.title = f.path || f.name;
      chip.querySelector('small').textContent = `${f.photo ? 'Photo · ' : ''}${size(f.size)} · ${f.status === 'done' ? 'Ready' : f.status === 'error' ? f.error : f.status === 'queued' ? 'Waiting to upload' : f.progress >= 100 ? 'Saving on PC…' : 'Uploading ' + f.progress + '%'}`;
      const progress = chip.querySelector('progress'); progress.hidden = f.status !== 'uploading'; progress.value = f.progress || 0; progress.setAttribute('aria-label', 'Upload progress for ' + f.name);
      const remove = chip.querySelector('button'); remove.dataset.removeFile = f.id; remove.setAttribute('aria-label', 'Remove ' + f.name); remove.disabled = disabled;
    }
    list.hidden = !d.items.length;
    const status = d.host.querySelector('.attachment-status');
    const summary = ['done', 'uploading', 'queued', 'error'].map(s => {
      const count = d.items.filter(f => f.status === s).length;
      return count ? count + ' ' + ({done:'ready',uploading:'uploading',queued:'waiting',error:'need attention'})[s] : '';
    }).filter(Boolean).join(', ');
    if (status.textContent !== summary) status.textContent = summary;
    d.host.querySelectorAll('[data-pick]').forEach(b => b.disabled = disabled);
    d.change?.();
  }
  function remove(d, id) {
    if (!editable(d)) return;
    const f = d.items.find(x => x.id === id); if (!f) return;
    d.items = d.items.filter(x => x !== f); f.removed = true; f.xhr?.abort();
    if (f.reference) d.write(d.read().replace(f.reference, '').trimEnd());
    render(d); pump(d);
  }
  function reveal(d, f) {
    if (!f || !d.host?.isConnected) return;
    const list = d.host.querySelector('.attachment-list'), chip = list?.querySelector(`[data-file="${f.id}"]`);
    if (!chip) return;
    const bounds = list.getBoundingClientRect(), item = chip.getBoundingClientRect();
    if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom;
    else if (item.top < bounds.top) list.scrollTop -= bounds.top - item.top;
  }
  function pump(d) {
    let slots = 2 - d.items.filter(f => f.status === 'uploading').length;
    for (const f of d.items) if (slots > 0 && f.status === 'queued') { slots--; upload(d, f); }
  }
  function upload(d, f) {
    f.status = 'uploading'; f.progress = 0;
    const xhr = f.xhr = new XMLHttpRequest();
    const finish = error => {
      f.xhr = null; f.file = null;
      if (f.removed) return;
      if (error) { f.status = 'error'; f.error = error; }
      render(d); if (error) reveal(d, f); pump(d);
    };
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('X-Nexus', '1');
    xhr.setRequestHeader('X-Nexus-Filename', encodeURIComponent(f.name));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.timeout = 5 * 60 * 1000;
    xhr.upload.onprogress = e => { if (f.removed) return; f.progress = e.lengthComputable ? Math.round(e.loaded / e.total * 100) : 0; render(d); };
    xhr.onload = () => {
      let result; try { result = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status !== 200 || typeof result?.path !== 'string' || typeof result?.name !== 'string' || !Number.isFinite(result?.size)) return finish(result?.error || (xhr.status === 401 ? 'Pair this device again, then attach the file.' : 'Upload failed. Remove this file and attach it again.'));
      if (f.removed) return;
      f.path = result.path; f.name = result.name; f.size = result.size; f.status = 'done';
      f.reference = ref(f.path, d.kind);
      const text = d.read(); d.write(text + (text && !text.endsWith('\n') ? '\n' : '') + f.reference);
      finish();
    };
    xhr.onerror = () => finish('Connection lost. Remove this file and attach it again.');
    xhr.ontimeout = () => finish('Upload timed out. Try a smaller file or attach it again.');
    xhr.onabort = () => finish('Upload canceled.');
    try { xhr.send(f.file); } catch { finish('Could not upload this file. Attach it again.'); }
    render(d);
  }
  function add(d, files) {
    if (!editable(d)) return;
    for (const file of files) {
      const large = file.size > maxFile;
      d.items.push({ id: String(++serial), file: large ? null : file, name: file.name || 'attachment', size: file.size, photo: file.type.startsWith('image/') || /\.(heic|heif)$/i.test(file.name), status: large ? 'error' : 'queued', error: large ? 'Too large. Choose a file or shorter video under 50 MB.' : '' });
    }
    render(d); reveal(d, d.items.at(-1)); pump(d);
  }
  // Dropping never uploads (the clip does): it writes where the file already lives on this PC.
  function insert(d, zone, text) {
    const input = zone.querySelector('textarea'), current = d.read();
    const focused = input && document.activeElement === input;
    const start = focused ? input.selectionStart : current.length, end = focused ? input.selectionEnd : current.length;
    const before = current.slice(0, start), after = current.slice(end);
    const lead = before && !/\s$/.test(before) ? ' ' : '', tail = after && !/^\s/.test(after) ? ' ' : '';
    d.write(before + lead + text + tail + after);
    if (input?.isConnected) { const caret = (before + lead + text).length; input.focus(); input.setSelectionRange(caret, caret); input.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  async function dropPaths(d, zone, dt) {
    const paths = (dt.getData('text/uri-list') || '').split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith('#')).map(fromUri).filter(Boolean);
    const wanted = paths.length ? [] : Array.from(dt.items || []).filter(i => i.kind === 'file').map(i => {
      const f = i.getAsFile(), entry = i.webkitGetAsEntry?.();
      return f && { name: f.name, size: f.size, lastModified: f.lastModified, dir: !!entry?.isDirectory };
    }).filter(Boolean);
    if (!editable(d) || !paths.length && !wanted.length) return;
    const missing = [];
    zone.dataset.dropLabel = 'Finding the path on this PC…'; zone.classList.add('attachment-drag', 'attachment-locating');
    try {
      const cwd = typeof d.cwd === 'function' ? d.cwd() : d.cwd || '';
      for (const w of wanted) { const r = await postNexus('/api/locate-file', { ...w, cwd }); if (r.path) paths.push(r.path); else missing.push(w.name); }
    } catch (error) { toast('Path not inserted', error.message, 'bad'); return; }
    finally { zone.classList.remove('attachment-drag', 'attachment-locating'); delete zone.dataset.dropLabel; }
    if (paths.length && editable(d)) insert(d, zone, paths.map(quote).join(' '));
    if (missing.length) toast('Path not found', `Couldn't find ${missing.join(', ')} on this PC. Paste its path, or upload it with the clip.`, 'bad');
  }
  function mount(host, options) {
    const d = drafts.get(options.key) || { items: [] };
    Object.assign(d, options, { host }); drafts.set(d.key, d);
    host.dataset.attachKey = d.key;
    host.innerHTML = `<div class="attachment-tools"><button type="button" class="btn attach-button" data-pick="file" aria-label="Attach files" title="Attach files (up to 50 MB each)">${clip}<span class="attachment-label">Attach</span></button><button type="button" class="btn" data-pick="photo" aria-label="Attach photo" title="Attach photo"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/></svg><span class="attachment-label">Photo</span></button><span>50 MB per file<span class="drop-hint"> · paste an image to attach it, drop a file to insert its path</span></span></div><input type="file" multiple hidden data-file-picker="file"><input type="file" accept="image/*" multiple hidden data-file-picker="photo"><ul class="attachment-list" aria-label="Attached files" hidden></ul><span class="sr-only attachment-status" role="status"></span>`;
    host.onclick = e => {
      const pick = e.target.closest('[data-pick]');
      if (pick && editable(d)) host.querySelector(`[data-file-picker="${pick.dataset.pick}"]`).click();
      const button = e.target.closest('[data-remove-file]'); if (button) remove(d, button.dataset.removeFile);
    };
    host.onchange = e => { if (e.target.matches('[data-file-picker]')) { add(d, Array.from(e.target.files)); e.target.value = ''; } };
    const zone = options.dropZone || host;
    if (getComputedStyle(zone).position === 'static') zone.style.position = 'relative';
    zone.ondragover = e => {
      if (!hasFiles(e.dataTransfer) || zone.classList.contains('attachment-locating')) return;
      e.preventDefault(); e.dataTransfer.dropEffect = editable(d) ? 'link' : 'none';
      zone.dataset.dropLabel = editable(d) ? 'Drop to insert the file path' : 'Wait until the message is sent'; zone.classList.add('attachment-drag');
    };
    zone.ondragleave = e => { if (!zone.contains(e.relatedTarget) && !zone.classList.contains('attachment-locating')) zone.classList.remove('attachment-drag'); };
    zone.ondrop = e => {
      const dt = e.dataTransfer, files = hasFiles(dt), uris = /^file:/im.test(dt?.getData('text/uri-list') || '');
      if (!files && !uris) return;
      e.preventDefault(); e.stopPropagation(); zone.classList.remove('attachment-drag'); dropPaths(d, zone, dt);
    };
    // Pasting a screenshot or copied picture uploads it like the clip. Cells or text copied with a picture of them
    // (Excel, Word) paste as text.
    zone.onpaste = e => {
      const cd = e.clipboardData, files = Array.from(cd?.files || []);
      if (!files.length || cd.getData('text/plain').trim()) return;
      e.preventDefault();
      if (editable(d)) add(d, files.map(pasted)); else toast('Not attached', 'Wait until the message is sent, then paste again.', 'bad');
    };
    render(d);
  }
  function clear(key) {
    const d = drafts.get(key); if (!d) return;
    for (const f of d.items) { f.removed = true; f.xhr?.abort(); }
    d.items = []; render(d);
  }
  return {
    mount, blocked, refresh(key) { const d = drafts.get(key); if (d) render(d); }, clear,
    setKind(key, kind) {
      const d = drafts.get(key); if (!d) return;
      let text = d.read();
      for (const f of d.items) if (f.reference) { const next = ref(f.path, kind); text = text.replace(f.reference, next); f.reference = next; }
      d.kind = kind; d.write(text); render(d);
    },
    newDraft(key) { newKey = key; },
    discardNew() { if (newKey) { clear(newKey); drafts.delete(newKey); newKey = null; } },
    move(from, to, binding = {}) { const d = drafts.get(from); if (!d) return; drafts.delete(from); Object.assign(d, binding, { key: to, host: null }); drafts.set(to, d); if (newKey === from) newKey = null; }
  };
})();
