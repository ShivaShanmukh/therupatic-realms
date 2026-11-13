// Tiny DOM helpers. All user-visible strings go through textContent (no innerHTML with data).
type Attrs = Record<string, string | number | boolean | undefined | null | EventListener>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

const ICONS: Record<string, string> = {
  pause: '<path d="M8 5v14M16 5v14" stroke-width="2.4" stroke-linecap="round"/>',
  play: '<path d="M7 5l12 7-12 7z" stroke-width="2" stroke-linejoin="round"/>',
  leave: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke-width="2"/>',
  back: '<path d="M10 6l-6 6 6 6M4 12h16" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<path d="M5 12l5 5 9-10" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  dot: '<circle cx="12" cy="12" r="5" stroke-width="2"/>',
};

export function icon(name: keyof typeof ICONS | string): SVGSVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" focusable="false" class="icon">${ICONS[name] ?? ''}</svg>`;
  return wrap.firstElementChild as SVGSVGElement;
}
