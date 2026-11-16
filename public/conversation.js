// Shared recognition of the current input box and interactive menus, not scrollback.
(function (root) {
  const rule = /[─━╌]{3,}/;
  const guidance = /esc(?:ape)? to|enter to|press enter|tab to|arrow keys|↑.*↓/i;
  const heading = /do you (?:want|trust)|would you like|make auto mode your default permission mode\?|allow .+\?|proceed\?|approve .+\?|permission required|is this .+trust|(?:which|what|how|where|when|should|select|choose) .+\?/i;
  const plainLines = screen => String(screen || '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').split('\n').map(line => line.replace(/^\s*│ ?/, '').replace(/ ?│\s*$/, '').replace(/^\s*[╭╰][─━]+[╮╯]\s*$/, ''));
  const contextBefore = (lines, start) => lines.slice(Math.max(0, start - 12), start).filter(l => !/^[─━╌\s]+$/.test(l)).join('\n').trim().slice(-1600);
  // A numbered list with its selection marker at the bottom of the screen is a question, whatever its wording, with or
  // without a footer, and even when a long list pushed the question off the top. An input box below it (a rule, or
  // Codex's prompt over its footer) makes it a past message the owner sent.
  function numberedMenu(lines, end) {
    const number = /^\s*([>❯›])?\s*([1-9])[.)]\s+(.+)$/, marked = lines.slice(0, end).findLastIndex(l => /^\s*[>❯›]\s*[1-9][.)]\s/.test(l));
    if (marked < 0 || lines.slice(marked, end).some(l => rule.test(l)) || (inputBox(lines)?.top ?? -1) > marked || inputBusy(lines.slice(marked).join('\n'))) return null;
    let first = marked;
    for (let i = marked; i >= Math.max(0, marked - 30) && lines[first].match(number)[2] !== '1'; i--) if (number.test(lines[i])) first = i;
    const options = [];
    for (const line of lines.slice(first, end)) {
      const m = line.match(number);
      if (m) options.push({key:m[2], label:m[3].trim()});
      else if (line.trim()) options.at(-1).label += ' ' + line.trim();
    }
    if (options.length < 2 || new Set(options.map(o => o.key)).size !== options.length) return null;
    let close = first;
    while (close > 0 && !lines[close - 1].trim()) close--;
    let top = close;
    while (top > 0 && lines[top - 1].trim() && !rule.test(lines[top - 1]) && !/^[▔▁\s]+$/.test(lines[top - 1])) top--;
    const text = lines.slice(top, close).map(l => l.trim()).join(' ') || 'Choose an option', context = contextBefore(lines, top);
    const mode = /↑.*↓.*navigate/i.test(lines[end] || '') ? 'arrows' : 'number';
    return {question:text, context, options, selected:lines[marked].match(number)[2], mode, signature:JSON.stringify([context, text, options])};
  }
  function pendingPrompt(screen) {
    // Claude 2.1.310's onboarding select omits the usual Enter/Esc footer.
    // Recognize this exact two-choice menu so it cannot be mistaken for input.
    if(/Make auto mode your default permission mode\?/i.test(screen)&&/Yes, set auto mode as my default permission mode/.test(screen)&&/No, keep manual mode\s*$/.test(screen)&&!guidance.test(String(screen).split('Make auto mode your default permission mode?').at(-1)))screen+='\nEnter to confirm';
    const lines = plainLines(screen);
    // A named session has its title inside the rule below the footer, so any rule counts as the end of the screen.
    const last = lines.findLastIndex(l => l.trim() && !rule.test(l));
    if (!guidance.test(lines[last] || '')) return numberedMenu(lines, lines.length);
    const end = last, option = /^\s*([>❯›])?\s*([1-9])[.)]\s+(.+)$/;
    // A question mark in an option's label or in its indented description is not the question, nor is one above the
    // rule that opens the dialog: that line is the conversation behind it.
    const inOption = i => { if (option.test(lines[i])) return true; for (let j = i - 1; j >= 0 && lines[j].trim(); j--) { const m = lines[j].match(option); if (m) return lines[i].search(/\S/) >= lines[j].indexOf(m[3]); } return false; };
    const behind = i => { const first = lines.findIndex((l, j) => j > i && option.test(l)); return lines.slice(i, first < 0 ? end : Math.min(first, end)).some(l => rule.test(l)); };
    let start = end;
    do start = lines.slice(0, start).findLastIndex(line => heading.test(line)); while (start >= 0 && (inOption(start) || behind(start)));
    const options = [], question = [];
    let selected = null;
    if (start >= 0) {
      for (const line of lines.slice(start, end)) {
        const m = line.match(option);
        if (m) { options.push({key:m[2], label:m[3].trim()}); if (m[1]) selected = m[2]; }
        else if (!options.length) question.push(line.trim());
        else if (line.trim() && !rule.test(line)) options.at(-1).label += ' ' + line.trim();
      }
      // "shift+tab to cycle" under an idle composer reads like a footer: a numbered reply above it is not a question,
      // nor is a numbered question typed in the box.
      const composer = lines.slice(start, end).some((l, i, a) => i && rule.test(a[i - 1]) && /^\s*[❯›>](?!\s*[1-9][.)])(\s|$)/.test(l)) || (inputBox(lines)?.footer ?? -1) > start;
      if (!composer && options.length >= 2 && new Set(options.map(o => o.key)).size === options.length) {
        const text = question.join(' ').trim();
        const context = contextBefore(lines, start);
        const mode=/↑.*↓.*navigate/i.test(lines[end])?'arrows':'number';
        return {question:text, context, options, selected, mode, signature:JSON.stringify([context, text, options])};
      }
    }
    const numbered = numberedMenu(lines, end);
    if (numbered) return numbered;
    // Unnumbered select lists have one marker, aligned option labels, and an
    // explicit selection footer. The marker can be on any option, not just first.
    if (!/enter to (?:confirm|select)|press enter|arrow keys|↑.*↓/i.test(lines[end])) return null;
    const marked = lines.slice(0, end).findLastIndex(l => /^\s*[❯›>]\s+\S/.test(l));
    if (marked < 0) return null;
    const mark = lines[marked].match(/^(\s*)[❯›>](\s+)(.+)$/), indent = mark[1].length + 1 + mark[2].length;
    if (/^[1-9][.)]\s/.test(mark[3]) || rule.test(mark[3])) return null;
    let first = marked;
    for (let i = marked - 1; i >= 0; i--) {
      if (!lines[i].trim()) continue;
      if (!new RegExp('^ {' + indent + ',}\\S').test(lines[i]) || guidance.test(lines[i]) || rule.test(lines[i])) break;
      first = i;
    }
    const choices = [];
    for (let i = first; i < end; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const m = line.match(/^(\s*)([❯›>]\s+)?(\S.*)$/);
      if (!m || rule.test(line)) return null;
      if (i === marked || !m[2] && m[1].length === indent) {
        const key = String(choices.length + 1);
        choices.push({key, label:i === marked ? mark[3].trim() : m[3].trim()});
        if (i === marked) selected = key;
      } else if (!m[2] && m[1].length > indent && choices.length) choices.at(-1).label += ' ' + line.trim();
      else return null;
    }
    if (choices.length < 2 || !selected) return null;
    const questionStart = start >= 0 && start < first ? start : Math.max(0, lines.slice(0, first).findLastIndex(l => l.trim() && !rule.test(l)));
    const text = lines.slice(questionStart, first).join(' ').trim() || 'Choose an option';
    const context = contextBefore(lines, questionStart);
    return {question:text, context, options:choices, selected, mode:'arrows', signature:JSON.stringify(['arrows', context, text, choices])};
  }
  // The input box nearest the bottom: a prompt under a rule (or ending a titled rule) with a rule below, or Codex's
  // prompt over its own footer. Returns where the box starts and where its footer starts.
  function inputBox(lines) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const prompt = /^\s*[❯›>](?!\s*[1-9][.)])(\s|$)/.test(lines[i]);
      if (prompt && i && rule.test(lines[i - 1]) || rule.test(lines[i]) && /[❯›]\s*$/.test(lines[i])) {
        const close = lines.findIndex((l, j) => j > i && rule.test(l));
        if (close >= 0) return {top: prompt ? i - 1 : i, footer: close + 1};
      }
      // Codex's box runs from its prompt to its footer line; the lines between are typed text.
      const footer = /^\s*›(?!\s*[1-9][.)])(\s|$)/.test(lines[i]) ? lines.findIndex((l, j) => j > i && /\? for shortcuts|\d+% context left|^\s*\S+\s+(?:default|low|medium|high|xhigh)\s+·/i.test(l)) : -1;
      if (footer >= 0) return {top: i, footer};
    }
    return null;
  }
  const busyHint = /(?:esc(?:ape)?|ctrl[+-]c) to interrupt/i;
  const menuHint = /(?:esc(?:ape)? (?:to )?(?:cancel|close|go back|return|dismiss)|press esc(?:ape)?|enter to (?:select|confirm)|space to (?:select|toggle)|↑.*↓.*(?:navigate|select))/i;
  // A status row prints its hint on one line, in parentheses or after a '·' or '•' separator.
  const statusHint = hint => new RegExp('(?:\\(|\\S[ \\t]*[·•])[ \\t]*' + hint.source, 'i');
  const busyStatus = statusHint(busyHint), menuStatus = statusHint(menuHint);
  // A quote may wrap onto the next screen line; a status row has no quotes, so a span never covers one.
  const quoted = /"[^"\n]*(?:\n[^"\n]*)?"|“[^”\n]*(?:\n[^”\n]*)?”|`[^`\n]*(?:\n[^`\n]*)?`/g;
  // Agents print key hints in the box footer, or in a status row between the last reply and the box ("Working (12s •
  // esc to interrupt)"). Above the box the same words in a reply (Claude starts each with '●', a status row never),
  // quoted, in a sentence or across lines, are conversation; the box holds typed text.
  function hinted(lines, hint, status) {
    const box = inputBox(lines);
    if (!box) return hint.test(lines.join('\n'));
    const above = lines.slice(0, box.top).join('\n').replace(quoted, m => m.replace(/[^\n]/g, ' ')).split('\n');
    return above.slice(above.findLastIndex(l => /^\s*[●⏺]/.test(l)) + 1).some(l => status.test(l)) || hint.test(lines.slice(box.footer).join('\n'));
  }
  function inputBusy(screen) { return hinted(plainLines(String(screen || '').slice(-1600)), busyHint, busyStatus); }
  // Copilot's model picker contains a search box shaped like the composer.
  const pickerHint = /enter to select/i, pickerStatus = statusHint(pickerHint);
  const modelPicker = screen => /Search models|Select model|Choose a model/i.test(screen) && hinted(plainLines(screen), pickerHint, pickerStatus);
  function inputMenu(screen) {
    if(pendingPrompt(screen))return true;
    if(/Help\s+General\s+Commands\s+Custom commands/.test(screen))return true;
    // Menus can keep the old composer on screen, or contain a composer-shaped search field.
    // Reject their selection/close footer even after this terminal has shown input before.
    return hinted(plainLines(screen).slice(-12), menuHint, menuStatus) || modelPicker(screen);
  }
  function inputReady(screen, { seenInput = false } = {}) {
    if (modelPicker(screen)) return false;
    const lines = plainLines(screen);
    if (inputMenu(screen)) return false;
    // A wrapped/unrecognized numbered menu must never become a text composer. Above the input box such a line
    // is a numbered message the owner sent earlier.
    if(lines.slice(inputBox(lines)?.top || 0).some(line=>/^\s*[❯›>]\s*[1-9][.)]\s+/.test(line)))return false;
    // A remembered input does not make a clipped menu into a composer. Claude
    // may still queue text while working; idle sends need a current input shape.
    if (seenInput && inputBusy(screen)) return true;
    // Footer, placeholder, past input and session-name text are deliberately not
    // enumerated. A prompt next to a box rule is the structural startup signal.
    return lines.some((line, i) => /[❯›]/.test(line) && lines.slice(Math.max(0, i - 1), i + 2).some(l => rule.test(l))) ||
      lines.some((line, i) => /^\s*[❯›]/.test(line) && lines.slice(i + 1).some(l => /\? for shortcuts|\d+% context left/i.test(l))) ||
      lines.some((line,i)=>/^\s*›(?:\s|$)/.test(line)&&lines.slice(i+1).some(l=>/^\s*\S+\s+(?:default|low|medium|high|xhigh)\s+·/.test(l)));
  }
  if (typeof module === 'object') module.exports = {pendingPrompt, inputReady, inputBusy, inputMenu};
  else root.NexusConversation = {pendingPrompt, inputReady, inputBusy, inputMenu};
})(typeof window === 'object' ? window : globalThis);
