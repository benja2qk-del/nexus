'use strict';
// The one page script that still knows the agent's old name. NEXUS used to call the Codex CLI agent "Astra";
// a page of that build stored three things under the old name in localStorage. This moves them, once, when the
// page loads (before polish.js, slash-picker.js and the new-session dialog read them). A second load changes nothing.
//   nexus.place              {key:'astra:<id>', ...}          -> key 'codex:<id>' (group and project are folder names: kept)
//   nexus.new-model-astra    a model id                        -> nexus.new-model-codex (value kept, even 'gpt-6-astra')
//   nexus.prefs              {slashUsage:{astra:{...}}, ...}   -> slashUsage.codex (counts added, later at kept)
(function (root) {
  const OLD = 'astra', NEW = 'codex';
  function migrateStorage(storage) {
    if (!storage) return;
    try {
      const raw = storage.getItem('nexus.place'), place = raw && JSON.parse(raw);
      if (place && typeof place.key === 'string' && place.key.startsWith(OLD + ':')) {
        place.key = NEW + ':' + place.key.slice(OLD.length + 1);
        storage.setItem('nexus.place', JSON.stringify(place));
      }
    } catch { }
    try {
      const old = storage.getItem('nexus.new-model-' + OLD);
      if (old !== null && old !== undefined) {
        if (storage.getItem('nexus.new-model-' + NEW) === null) storage.setItem('nexus.new-model-' + NEW, old);
        storage.removeItem('nexus.new-model-' + OLD);
      }
    } catch { }
    try {
      const raw = storage.getItem('nexus.prefs'), prefs = raw && JSON.parse(raw), usage = prefs && prefs.slashUsage;
      if (usage && typeof usage === 'object' && Object.prototype.hasOwnProperty.call(usage, OLD)) {
        const from = usage[OLD] || {}, to = usage[NEW] && typeof usage[NEW] === 'object' ? usage[NEW] : {};
        for (const [command, u] of Object.entries(from)) {
          const t = to[command];
          to[command] = !t ? u : { ...t, count: (Number(t.count) || 0) + (Number(u && u.count) || 0), at: Math.max(Number(t.at) || 0, Number(u && u.at) || 0) };
        }
        usage[NEW] = to; delete usage[OLD];
        storage.setItem('nexus.prefs', JSON.stringify(prefs));
      }
    } catch { }
  }
  if (typeof module === 'object' && module.exports) module.exports = { migrateStorage };
  else { try { migrateStorage(root.localStorage); } catch { } }
})(typeof window !== 'undefined' ? window : globalThis);
