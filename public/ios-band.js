// iPhone home-screen app: iOS leaves a band below the page that no element can paint; it takes the
// theme-color. Match the opaque root canvas beneath the translucent dock and conversation.
(function () {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  // theme-color is only safe as hex; the design tokens are oklch.
  const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
  const gamma = c => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  function toHex(color) {
    const m = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/i.exec(color);
    if (m) {
      const L = parseFloat(m[1]) / (m[2] ? 100 : 1), C = parseFloat(m[3]), h = parseFloat(m[4]) * Math.PI / 180;
      const a = C * Math.cos(h), b = C * Math.sin(h);
      const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
      return hex(gamma(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s), gamma(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s), gamma(-0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * s));
    }
    const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(color);
    return rgb ? hex(rgb[1] / 255, rgb[2] / 255, rgb[3] / 255) : '';
  }
  let last = '';
  function sync() {
    if (!matchMedia('(max-width: 700px)').matches) return;
    // The dock is translucent. Using its raw RGB discards alpha and creates a
    // different band. The root paints the area outside the viewport in every view.
    const color = toHex(getComputedStyle(document.documentElement).backgroundColor);
    if (color && color !== last) { meta.content = color; last = color; }
  }
  const watch = new MutationObserver(sync);
  addEventListener('DOMContentLoaded', () => {
    sync();
    const app = document.getElementById('app');
    if (app) watch.observe(app, { attributes: true, attributeFilter: ['data-view', 'class'] });
    watch.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  });
  addEventListener('pageshow', sync);
  addEventListener('resize', sync);
  setTimeout(sync, 1500);
})();
