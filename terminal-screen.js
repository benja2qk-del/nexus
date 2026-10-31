'use strict';
// Bounded current-screen model for detection, not a second terminal renderer.
// xterm still owns display/scrollback. Cells include wide-character continuations.
const isWide = c => /\p{Emoji_Presentation}/u.test(c) || (() => {
  const n = c.codePointAt(0);
  return n >= 0x1100 && (n <= 0x115f || n === 0x2329 || n === 0x232a ||
    n >= 0x2e80 && n <= 0xa4cf && n !== 0x303f || n >= 0xac00 && n <= 0xd7a3 ||
    n >= 0xf900 && n <= 0xfaff || n >= 0xfe10 && n <= 0xfe19 ||
    n >= 0xfe30 && n <= 0xfe6f || n >= 0xff00 && n <= 0xff60 ||
    n >= 0xffe0 && n <= 0xffe6 || n >= 0x20000 && n <= 0x3fffd);
})();
class TerminalScreen {
  constructor(cols = 120, rows = 36) {
    this.pending = ''; this.saved = [0, 0]; this.x = this.y = 0;
    this.wrap = true; this.synchronized = false; this.alternate = null;
    this.resize(cols, rows);
  }
  blank() { return Array.from({length:this.rows}, () => []); }
  resize(cols, rows) {
    this.cols = Math.max(1, Math.min(500, Math.floor(cols)));
    this.rows = Math.max(1, Math.min(200, Math.floor(rows)));
    const fit = lines => Array.from({length:this.rows}, (_, i) => {
      const line = (lines?.[i] || []).slice(0, this.cols);
      if (lines?.[i]?.[this.cols] === null) line[this.cols - 1] = ' ';
      return line;
    });
    this.lines = fit(this.lines);
    if (this.alternate) this.alternate.lines = fit(this.alternate.lines);
    this.x = Math.min(this.x, this.cols - 1); this.y = Math.min(this.y, this.rows - 1);
    this.top = 0; this.bottom = this.rows - 1; this.lastCell = null;
  }
  scroll(n, down = false, top = this.top) {
    n = Math.min(n, this.bottom - top + 1);
    if (n <= 0) return;
    this.lines.splice(down ? this.bottom - n + 1 : top, n);
    this.lines.splice(down ? top : this.bottom - n + 1, 0, ...Array.from({length:n}, () => []));
  }
  down() { if (this.y === this.bottom) this.scroll(1); else this.y = Math.min(this.y + 1, this.rows - 1); }
  erase(start, end) {
    const line = this.lines[this.y];
    if (line[start] === null && start) line[start - 1] = ' ';
    if (line[end] === null) line[end] = ' ';
    for (let x = start; x < Math.min(end, this.cols); x++) line[x] = ' ';
  }
  restore() {
    this.x = Math.max(0, Math.min(this.saved[0], this.cols - 1));
    this.y = Math.max(0, Math.min(this.saved[1], this.rows - 1));
  }
  csi(params, intermediate, op) {
    const prefix = /^[<=>?]/.test(params) ? params[0] : '';
    const args = params.replace(/^[<=>?]/, '').split(';').map(Number), n = args[0] || 1;
    if (prefix) {
      if (prefix === '?' && (op === 'h' || op === 'l')) for (const mode of args) {
        const on = op === 'h';
        if (mode === 7) this.wrap = on;
        if (mode === 2026) this.synchronized = on;
        if (mode === 1049) {
          if (on && !this.alternate) {
            this.alternate = {lines:this.lines, x:this.x, y:this.y, saved:this.saved, top:this.top, bottom:this.bottom};
            this.lines = this.blank(); this.x = this.y = 0; this.saved = [0, 0]; this.top = 0; this.bottom = this.rows - 1;
          } else if (!on && this.alternate) {
            Object.assign(this, this.alternate); this.alternate = null;
            this.x = Math.min(this.x, this.cols - 1); this.y = Math.min(this.y, this.rows - 1);
            this.top = Math.min(this.top, this.rows - 1); this.bottom = Math.min(this.bottom, this.rows - 1);
          }
        }
      }
      // In particular CSI ? u is a keyboard query, NOT cursor restore.
      return;
    }
    if (intermediate || op === 'm') return; // Styling never changes cell positions.
    this.lastCell = null;
    if ('ABCDEFGHf\x60d'.includes(op)) this.x = Math.min(this.x, this.cols - 1);
    if (op === 'A') this.y = Math.max(0, this.y - n);
    if (op === 'B' || op === 'e') this.y = Math.min(this.rows - 1, this.y + n);
    if (op === 'C' || op === 'a') this.x = Math.min(this.cols - 1, this.x + n);
    if (op === 'D') this.x = Math.max(0, this.x - n);
    if (op === 'E' || op === 'F') { this.y = Math.max(0, Math.min(this.rows - 1, this.y + (op === 'E' ? n : -n))); this.x = 0; }
    if (op === 'G' || op === '\x60') this.x = Math.min(this.cols - 1, n - 1);
    if (op === 'd') this.y = Math.min(this.rows - 1, n - 1);
    if (op === 'H' || op === 'f') { this.y = Math.min(this.rows - 1, n - 1); this.x = Math.min(this.cols - 1, (args[1] || 1) - 1); }
    if (op === 'J') {
      if (args[0] === 2) this.lines = this.blank();
      else if (!args[0]) { this.erase(this.x, this.cols); for (let y = this.y + 1; y < this.rows; y++) this.lines[y] = []; }
      else if (args[0] === 1) { this.erase(0, this.x + 1); for (let y = 0; y < this.y; y++) this.lines[y] = []; }
      // J=3 erases scrollback only; this model has none.
    }
    if (op === 'K') this.erase(args[0] === 1 || args[0] === 2 ? 0 : this.x, args[0] === 1 ? this.x + 1 : this.cols);
    if (op === 'X') this.erase(this.x, this.x + n);
    if (op === '@' || op === 'P') {
      const line = this.lines[this.y], count = Math.min(n, this.cols - this.x);
      while (line.length < this.cols) line.push(' ');
      if (line[this.x] === null) { line[this.x - 1] = ' '; line[this.x] = ' '; }
      if (op === '@') line.splice(this.x, 0, ...Array(count).fill(' '));
      else { if (line[this.x + count] === null) line[this.x + count] = ' '; line.splice(this.x, count); }
      if (line[this.cols] === null) line[this.cols - 1] = ' ';
      line.length = Math.min(line.length, this.cols);
    }
    if ((op === 'L' || op === 'M') && this.y >= this.top && this.y <= this.bottom) this.scroll(n, op === 'L', this.y);
    if (op === 'S' || op === 'T') this.scroll(n, op === 'T');
    if (op === 'r') {
      const top = n - 1, bottom = (args[1] || this.rows) - 1;
      if (top >= 0 && top < bottom && bottom < this.rows) { this.top = top; this.bottom = bottom; this.x = this.y = 0; }
    }
    if (op === 's') this.saved = [this.x, this.y];
    if (op === 'u') this.restore();
  }
  put(c) {
    const previous = this.lastCell, cell = previous && this.lines[previous.y]?.[previous.x];
    const extend = /[\p{Mark}\p{Emoji_Modifier}\u200d]/u.test(c) || cell?.endsWith('\u200d') ||
      /^\p{Regional_Indicator}$/u.test(c) && /^\p{Regional_Indicator}$/u.test(cell || '');
    if (extend && cell) {
      this.lines[previous.y][previous.x] += c;
      // Text-presentation symbols become two cells when followed by VS16.
      if (c === '\ufe0f' && this.lines[previous.y][previous.x + 1] !== null && previous.x + 1 < this.cols) {
        this.lines[previous.y][previous.x + 1] = null; this.x = Math.min(this.cols, this.x + 1);
      }
      return;
    }
    const width = isWide(c) ? 2 : 1;
    if (this.x >= this.cols || this.x + width > this.cols) {
      if (this.wrap) { this.x = 0; this.down(); }
      else this.x = Math.max(0, this.cols - width);
    }
    this.erase(this.x, this.x + width);
    const line = this.lines[this.y]; while (line.length < this.x) line.push(' ');
    line[this.x] = c; if (width === 2 && this.x + 1 < this.cols) line[this.x + 1] = null;
    this.lastCell = {x:this.x, y:this.y}; this.x = Math.min(this.cols, this.x + width);
  }
  write(data) {
    const input = this.pending + data; this.pending = '';
    for (let i = 0; i < input.length; i++) {
      const c = input[i];
      if (c === '\x1b') {
        if (i + 1 === input.length) { this.pending = input.slice(i); break; }
        const next = input[i + 1];
        if (next === '[') {
          const match = input.slice(i).match(/^\x1b\[([0-?]*)([ -/]*)([@-~])/);
          if (!match) { this.pending = input.slice(i).slice(-8192); break; }
          this.csi(match[1], match[2], match[3]); i += match[0].length - 1; continue;
        }
        if (']P_^'.includes(next)) {
          const match = input.slice(i).match(/^\x1b[\]P_^][\s\S]*?(?:\x07|\x1b\\)/);
          if (!match) { this.pending = input.slice(i).slice(-8192); break; }
          i += match[0].length - 1; continue;
        }
        if ('()#%'.includes(next)) { if (i + 2 >= input.length) {this.pending = input.slice(i); break;} i += 2; continue; }
        this.lastCell = null;
        if (next === '7') this.saved = [this.x, this.y];
        if (next === '8') this.restore();
        if (next === 'D' || next === 'E') { this.down(); if (next === 'E') this.x = 0; }
        if (next === 'M') { if (this.y === this.top) this.scroll(1, true); else this.y = Math.max(0, this.y - 1); }
        if (next === 'c') { this.lines = this.blank(); this.x = this.y = this.top = 0; this.bottom = this.rows - 1; this.saved = [0,0]; this.wrap = true; this.synchronized = false; this.alternate = null; }
        i++; continue;
      }
      if (c < ' ' || c === '\x7f') {
        this.lastCell = null;
        if (c === '\r') this.x = 0;
        if (c === '\n' || c === '\v' || c === '\f') this.down();
        if (c === '\b') this.x = Math.max(0, Math.min(this.x, this.cols - 1) - 1);
        if (c === '\t') this.x = Math.min(this.cols - 1, (Math.floor(this.x / 8) + 1) * 8);
        continue;
      }
      if (/[\ud800-\udbff]/.test(c) && i + 1 === input.length) { this.pending = c; break; }
      const point = String.fromCodePoint(input.codePointAt(i)); this.put(point); i += point.length - 1;
    }
  }
  text() { return this.lines.map(line => Array.from(line, c => c === null ? '' : c || ' ').join('').trimEnd()).join('\n').trimEnd(); }
}
module.exports = { TerminalScreen };
