// Shared recognition of the current input box and interactive menus, not scrollback.
(function (root) {
  const rule = /[─━╌]{3,}/;
  const guidance = /esc(?:ape)? to|enter to|press enter|tab to|arrow keys|↑.*↓/i;
  const heading = /do you (?:want|trust)|would you like|make auto mode your default permission mode\?|allow .+\?|proceed\?|approve .+\?|permission required|is this .+trust|(?:which|what|how|where|when|should|select|choose) .+\?/i;
  const plainLines = screen => String(screen || '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').split('\n').map(line => line.replace(/^\s*│ ?/, '').replace(/ ?│\s*$/, '').replace(/^\s*[╭╰][─━]+[╮╯]\s*$/, ''));
  const contextBefore = (lines, start) => lines.slice(Math.max(0, start - 12), start).filter(l => !/^[─━╌\s]+$/.test(l)).join('\n').trim().slice(-1600);
  // A numbered list with its selection marker at the bottom of the screen is a question, whatever its wording, with or
  // without a footer, and even when a long list pushed the question off the top. A composer always has a rule below it.
  function numberedMenu(lines, end) {
    const number = /^\s*([>❯›])?\s*([1-9])[.)]\s+(.+)$/, marked = lines.slice(0, end).findLastIndex(l => /^\s*[>❯›]\s*[1-9][.)]\s/.test(l));
    if (marked < 0 || lines.slice(marked, end).some(l => rule.test(l)) || inputBusy(lines.slice(marked).join('\n'))) return null;
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
    const end = last;
    const start = lines.slice(0, end).findLastIndex(line => heading.test(line));
    const options = [], question = [];
    let selected = null;
    if (start >= 0) {
      for (const line of lines.slice(start, end)) {
        const m = line.match(/^\s*([>❯›])?\s*([1-9])[.)]\s+(.+)$/);
        if (m) { options.push({key:m[2], label:m[3].trim()}); if (m[1]) selected = m[2]; }
        else if (!options.length) question.push(line.trim());
        else if (line.trim() && !rule.test(line)) options.at(-1).label += ' ' + line.trim();
      }
      if (options.length >= 2 && new Set(options.map(o => o.key)).size === options.length) {
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
  function inputBusy(screen) { return /esc(?:ape)? to interrupt|ctrl[+-]c to interrupt/i.test(String(screen || '').slice(-1600)); }
  function inputMenu(screen) {
    if(pendingPrompt(screen))return true;
    if(/Help\s+General\s+Commands\s+Custom commands/.test(screen))return true;
    const lines=plainLines(screen),tail=lines.slice(-12).join('\n');
    // Menus can keep the old composer on screen, or contain a composer-shaped search field.
    // Reject their selection/close footer even after this terminal has shown input before.
    return /(?:esc(?:ape)? (?:to )?(?:cancel|close|go back|return|dismiss)|press esc(?:ape)?|enter to (?:select|confirm)|space to (?:select|toggle)|↑.*↓.*(?:navigate|select))/i.test(tail) ||
      /(?:Search models|Select model|Choose a model)/i.test(screen)&&/enter to select/i.test(screen);
  }
  function inputReady(screen, { seenInput = false } = {}) {
    // Copilot's model picker contains a search box shaped like the composer.
    if (/Search models[….]|Select model|Choose a model/i.test(screen) && /enter to select/i.test(screen)) return false;
    const lines = plainLines(screen);
    if (inputMenu(screen)) return false;
    // A wrapped/unrecognized numbered menu must never become a text composer.
    if(lines.some(line=>/^\s*[❯›>]\s*[1-9][.)]\s+/.test(line)))return false;
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
