/*! fx.js: all the drama on this site lives in this file. The page is the straight man.
 *
 *   click          a very small "click" next to the cursor
 *   double click   DOUBLE CLICK! on a jagged burst, the way the 1966 Batman series settled its fights
 *   hold still     "uh oh" swells at the cursor, strains, overheats and bursts. A black hole opens where
 *                  it was and eats the page: every glyph, the photo, the icons, every box and hairline
 *   keep holding   what it ate becomes its accretion disk. The end state is Gargantua, turning for as long
 *                  as the button stays down
 *   release        everything snaps back as if nothing happened. "wtf"
 *   a fingertip    held still does what the mouse button does; the show plays just above it
 *
 * House rules. The page is never touched: its content is measured (Range rects), redrawn as sprites on an
 * overlay canvas and hidden by one stylesheet rule keyed on <html data-fx="charge|hole|restore">. Nothing
 * runs while idle: no frame loop, no timer, no canvas, no GL context before the first hold. Every way out
 * (release, Escape, blur, hidden tab, resize, lost context, exception) ends with the real page back.
 */
(() => {
'use strict';

const doc = document, html = doc.documentElement;
const { min, max, sin, cos, sqrt, exp, pow, atan2, floor, ceil, round, random, hypot, PI } = Math;
const TAU = PI * 2;
const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const ramp = (a, b, v) => { const t = sat((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const now = () => performance.now();
const calm = matchMedia('(prefers-reduced-motion: reduce)');

// ---- timing and feel
const HOLD = 220;      // ms a press has to rest before anything starts to strain
const CHARGE = 1680;   // ms of uh oh, so the bang lands 1.9s after the press
const DEFLATE = 150;   // ms to let the air out when the button comes up too early
const RESTORE = 400;   // ms from release to the real DOM being back
const BEAT = 240;      // ms of nothing before "wtf". Comedy is mostly waiting.
const SLOP = 6;        // px of travel that makes a press a text-selection drag instead
const SLOP_FINGER = 10; // a finger is never quite still
const BIG = 56;        // px: a glyph taller than this is a headline letter. It floats whole and is eaten in bites.
const LIFT = 64;       // px above a fingertip where everything happens, or the finger would cover the show
const OPEN = 0.2;      // s between the bang and the hole opening
const WAVE = 1900;     // px/s, the shockwave
const FLAT = 0.125;    // how flat the disk looks from where we sit (sine of the viewing angle)
const SHADOW = 2.6;    // radius of the shadow in Schwarzschild radii: 3*sqrt(3)/2, lensing included
const CLEAR = /^rgba\(.*,\s*0\)$|transparent/;
const BUSY = 'input,textarea,select,[contenteditable],video,audio,iframe,embed,object';  // a hold means something else here

// ---- the one stylesheet
const sheet = doc.createElement('style');
sheet.textContent = `
html[data-fx="hole"] main,html[data-fx="restore"] main{opacity:0!important}
html[data-fx],html[data-fx] *{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}
html[data-fx="hole"],html[data-fx="hole"] *{cursor:none!important}
.fx-root{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;pointer-events:none;overflow:hidden}
.fx-root canvas,.fx-dim{position:absolute;left:0;top:0;width:100%;height:100%;display:none}
.fx-label{position:absolute;padding:1px 3px 2px;border-radius:3px;font-size:10.5px;line-height:1;white-space:nowrap;opacity:0}
.fx-burst{position:absolute;opacity:0}
.fx-burst svg{display:block;overflow:visible}
.fx-word{position:absolute;left:0;top:0;font-weight:600;line-height:1;white-space:nowrap;display:none}
.fx-word i{position:absolute;left:0;top:0;width:0;height:0;display:flex;align-items:center;justify-content:center;font-style:normal}`;
doc.head.appendChild(sheet);

// ---- state: idle | charge | deflate | hole | restore
// "deflate" is ours alone; the attribute still says charge, because uh oh is still on screen.
let phase = 'idle';
function setPhase(p) {
  phase = p;
  const attr = p === 'deflate' ? 'charge' : p;
  if (p === 'idle') html.removeAttribute('data-fx');
  else if (html.dataset.fx !== attr) html.dataset.fx = attr;
}

let ui = null;  // our overlay: canvas, uh oh and the labels live here, nothing of the page does
function overlay() {
  if (!ui) {
    ui = doc.createElement('div');
    ui.className = 'fx-root';
    ui.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(ui);
  }
  return ui;
}

// ---- "click" and "wtf"
// A tiny word on a ring around the cursor, anywhere but 4-5 o'clock where the arrow would cover it,
// on a chip of the page's own paper so it reads over text.
let newest = null;  // the latest "click" label: a double click takes it back and shouts instead
function label(text, x, y, wtf) {
  const el = doc.createElement('span'), body = getComputedStyle(doc.body);
  const a = (80 + random() * 290) / 360 * TAU, c = cos(a), s = sin(a), r = 12 + random() * 14;
  const tilt = (random() - 0.5) * (wtf ? 8 : 16);
  const paper = [body.backgroundColor, getComputedStyle(html).backgroundColor].find((v) => !CLEAR.test(v)) || 'Canvas';
  x = min(max(x, 24), html.clientWidth - 24) + c * r;
  y = min(max(y, 24), html.clientHeight - 24) + s * r;
  el.className = 'fx-label';
  el.textContent = text;
  el.style.cssText = `left:${x}px;top:${y}px;color:${body.color};background:${paper};font-family:${body.fontFamily}`;
  overlay().appendChild(el);
  if (!wtf) newest = el;
  // anchored by the side that faces the cursor, so it sits outside the ring wherever it lands
  const at = (opacity, push, scale, offset = null) => ({
    opacity, offset,
    transform: `translate(calc(${c * 50 - 50}% + ${c * push}px),calc(${s * 50 - 50}% + ${s * push}px)) rotate(${tilt}deg) scale(${scale})`,
  });
  const anim = calm.matches
    ? el.animate([at(1, 0, 1), at(1, 0, 1, 0.8), at(0, 0, 1)], { duration: 600, fill: 'both' })
    : wtf  // pops in, sits there, pops away. Deadpan.
      ? el.animate([at(0, 0, 0.2), at(1, 0, 1.3, 0.1), at(1, 0, 1, 0.2), at(1, 0, 1, 0.84), at(1, 0, 1.4, 0.92), at(0, 0, 1.7)],
        { duration: 700, delay: BEAT, fill: 'both' })
      : el.animate([at(0.5, -5, 0.6), at(1, 0, 1, 0.08), at(1, 4, 1, 0.7), at(0, 7, 0.94)], { duration: 520, fill: 'both' });
  anim.onfinish = anim.oncancel = () => el.remove();
}

// ---- DOUBLE CLICK!
// The one loud thing on a quiet page: a fight card from the 1966 Batman series. Fat slanted capitals with an
// outline and a drop shadow on a jagged burst, next to the cursor, gone in well under a second.
const CARDS = [['#e4002b', '#ffd400'], ['#ffd400', '#e4002b'], ['#0a8fdc', '#ffffff'], ['#ff7a00', '#fff6c2']];  // burst, letters
const CARD_INK = '#141414';
const CARD_W = 176, CARD_H = 132;  // px on screen; the drawing itself is in a 200 x 150 box around 0,0
const CARD_FONT = '"Arial Black","Segoe UI Black","Helvetica Neue",Impact,"DejaVu Sans",Arial,sans-serif';
function burst(x, y) {
  const [paint, letters] = CARDS[floor(random() * CARDS.length)];
  const spikes = 12 + floor(random() * 4), turn = random() * TAU;
  let star = '';
  for (let i = 0; i < spikes * 2; i++) {  // long and short points in turn, none quite like its neighbour
    const a = turn + i / (spikes * 2) * TAU, r = i % 2 ? 0.6 + random() * 0.1 : 0.86 + random() * 0.14;
    star += `${(cos(a) * r * 98).toFixed(1)},${(sin(a) * r * 73).toFixed(1)} `;
  }
  // textLength pins the width of each word, so a fallback font cannot push the lettering out of the burst
  const word = (text, top, size, width) => `<text y="${top}" font-size="${size}" textLength="${width}" lengthAdjust="spacingAndGlyphs">${text}</text>`;
  const words = word('DOUBLE', -5, 36, 112) + word('CLICK!', 31, 42, 124);
  const el = doc.createElement('div');
  el.className = 'fx-burst';
  el.innerHTML = `<svg viewBox="-100 -75 200 150" width="${CARD_W}" height="${CARD_H}">
<polygon points="${star}" transform="translate(5 6)" fill="${CARD_INK}"/>
<polygon points="${star}" fill="${paint}" stroke="${CARD_INK}" stroke-width="3.5" stroke-linejoin="round"/>
<g transform="rotate(-7) skewX(-10)" font-family='${CARD_FONT}' font-weight="900" text-anchor="middle">
<g transform="translate(3.5 4.5)" fill="${CARD_INK}" stroke="${CARD_INK}" stroke-width="7" stroke-linejoin="round">${words}</g>
<g fill="${letters}" stroke="${CARD_INK}" stroke-width="7" stroke-linejoin="round" paint-order="stroke">${words}</g>
</g></svg>`;
  // above the cursor, a little to one side; below it when there is no room; never on top of it
  const vw = html.clientWidth, vh = html.clientHeight, reach = CARD_H / 2 + 22;
  const side = (random() < 0.5 ? -1 : 1) * (20 + random() * 50);
  const cx = min(max(x + side, CARD_W / 2 + 6), vw - CARD_W / 2 - 6);
  const cy = y - reach - CARD_H / 2 > 0 ? y - reach : min(y + reach, vh - CARD_H / 2 - 6);
  el.style.cssText = `left:${cx}px;top:${cy}px`;
  overlay().appendChild(el);
  const tilt = (random() - 0.5) * 14;
  const at = (opacity, scale, offset = null) => ({ opacity, offset, transform: `translate(-50%,-50%) rotate(${tilt}deg) scale(${scale})` });
  const anim = calm.matches
    ? el.animate([at(1, 1), at(1, 1, 0.85), at(0, 1)], { duration: 600, fill: 'both' })
    : el.animate([at(0, 0.15), at(1, 1.22, 0.16), at(1, 0.94, 0.26), at(1, 1, 0.34), at(1, 1, 0.8), at(1, 1.12, 0.9), at(0, 1.5)],
      { duration: 720, fill: 'both' });
  anim.onfinish = anim.oncancel = () => el.remove();
}

// ---- uh oh
const WORD = 'uh oh', N = WORD.length;
const GIVE = { u: 0.55, h: 0.8, o: 0.55, ' ': 0.3 };  // how far each letter lets itself be stretched
const HEAT = [[214, 40, 24], [255, 128, 20], [255, 246, 220]];
const word = { el: null, dim: null, glyphs: [], pose: [], wide: {}, ink: [0, 0, 0], family: '', peak: 100, size: 0, x: 0, y: 0 };
let pen = null;  // scratch 2D context, for measuring text

function summonWord() {
  const w = word, body = getComputedStyle(doc.body);
  if (!w.el) {
    pen = doc.createElement('canvas').getContext('2d');
    w.dim = overlay().appendChild(doc.createElement('div'));
    w.dim.className = 'fx-dim';
    w.el = overlay().appendChild(doc.createElement('div'));
    w.el.className = 'fx-word';
    for (const ch of WORD) {
      w.glyphs.push(w.el.appendChild(doc.createElement('i')));
      w.glyphs[w.glyphs.length - 1].textContent = ch;
      w.pose.push({ x: 0, y: 0, sx: 1, sy: 1 });
    }
  }
  w.family = body.fontFamily;
  w.ink = (body.color.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
  pen.font = `600 100px ${w.family}`;
  for (const ch of new Set(WORD)) w.wide[ch] = pen.measureText(ch).width / 100;
  w.peak = min(128, overlay().clientWidth * 0.9 / 4.2);  // font size at the bang
  w.x = mouse.x;
  w.y = mouse.y;
  w.el.style.fontFamily = w.family;
  w.el.style.display = w.dim.style.display = 'block';
}

// One frame of the word. u runs 0..1 over the charge; fade lets the air out (1 = full, 0 = gone).
function strain(u, t, dt, fade) {
  const w = word, k = sat(u);
  const push = 7 * (1 - pow(1 - k, 1.7));  // seven pushes, each closer to the last
  const surge = exp(-4 * (push % 1)) * ramp(0, 0.12, k);  // every push jumps, then half settles back
  const clench = ramp(0.945, 1, u);  // the last 90ms it goes rigid. That is how you know.
  const size = (8 + 15 * k + (w.peak - 23) * pow(k, 2.5)) * (1 + 0.09 * surge) * (1 - 0.12 * clench) * fade;
  const jitter = (0.25 + size * 0.045 * k * k) * (1 - 0.92 * clench);
  const follow = 1 - exp(-dt * 16);
  w.x += (mouse.x - w.x) * follow;
  w.y += (mouse.y - w.y) * follow;
  w.size = size;

  // ink, then red, then orange, then white-hot
  const stops = [w.ink, ...HEAT], h = max(0, k - 0.15) / 0.85 * 3, i0 = min(2, floor(h));
  const rgb = stops[i0].map((v, j) => round(mix(v, stops[i0 + 1][j], h - i0)));
  const glow = ramp(0.3, 1, k) * fade, st = w.el.style;
  st.fontSize = size + 'px';
  st.color = `rgb(${rgb})`;
  st.textShadow = `0 0 ${size * 0.05}px rgba(255,150,40,${glow}),0 0 ${size * 0.2}px rgba(255,70,0,${glow * 0.9}),0 0 ${size * 0.5}px rgba(255,40,0,${glow * 0.45})`;
  st.webkitTextStroke = `${size * 0.012 * glow}px rgba(190,40,0,${glow})`;
  st.transform = `translate(${w.x}px,${w.y - 16 * (1 - k) * (1 - k)}px) rotate(${(1 - fade) * 20}deg)`;     // deflating, it spins off
  // it draws the light out of the page around it, which is also what lets white-hot read on a white page
  const dusk = (0.5 * k * k + 0.12 * clench) * fade;
  w.dim.style.background = `radial-gradient(ellipse ${size * 6}px ${size * 3.2}px at ${w.x}px ${w.y}px,rgba(0,0,0,${dusk}),rgba(0,0,0,${dusk * 0.5}) 45%,rgba(0,0,0,0))`;

  // the letters stretch as it strains, the middle swells like a balloon, everything trembles
  const swell = (i) => 1 + 0.3 * k * k * sin((i + 0.5) / N * PI);
  let left = 0;
  for (let i = 0; i < N; i++) {
    const p = w.pose[i];
    p.sx = 1 + GIVE[WORD[i]] * pow(k, 1.5) * (0.72 + 0.28 * sin(t * 0.012 + i * 1.9));
    left -= w.wide[WORD[i]] * size * p.sx * swell(i) / 2;
  }
  for (let i = 0; i < N; i++) {
    const p = w.pose[i], big = swell(i), adv = w.wide[WORD[i]] * size * p.sx * big;
    p.x = left + adv / 2 + (random() - 0.5) * 2 * jitter;
    p.y = (random() - 0.5) * 2 * jitter - sin(i / (N - 1) * PI) * size * 0.07 * k;
    p.sy = big * (1 - 0.15 * surge * k - 0.2 * clench);
    left += adv;
    const turn = (random() - 0.5) * (3 + 15 * k * k) * (1 - clench), sx = p.sx * big * (1 + 0.08 * surge * k + 0.1 * clench);
    w.glyphs[i].style.transform = `translate(${p.x}px,${p.y}px) rotate(${turn}deg) scale(${sx},${p.sy})`;
  }
}

// ---- census: what does <main> actually render?
// Text per character (Range rects), img, inline svg, hr; no class names, no knowledge of this page.
// Everything is described in device pixels in document space: `sprites` are the distinct things to
// rasterise, `pieces` say where they go. It walks a few ms per frame so uh oh never stutters.
const PAINT = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'opacity', 'fill-opacity', 'stroke-opacity', 'color'];
const drawn = new Map();  // serialised svg -> decoded Image, kept between holds
const SHARDS = 24, SPARKS = 150, EXTRAS = WORD.length * SHARDS + SPARKS;

function census(dpr) {
  const main = doc.querySelector('main');
  const sprites = new Map(), pieces = [], groups = [], styles = new Map(), looks = new Map();
  const range = doc.createRange(), PAD = 2 * ceil(dpr), px = (v) => parseFloat(v) || 0;
  let node = main, at = 0, pending = 0, count = 0;

  const next = (n, skipKids) => {
    if (!skipKids && n.firstChild) return n.firstChild;
    for (; n && n !== main; n = n.parentNode) if (n.nextSibling) return n.nextSibling;
    return null;
  };

  // Everything that decides what a glyph looks like, per element. Underlines are handed down by hand:
  // text-decoration propagates to descendants without being an inherited property.
  function style(el) {
    let s = styles.get(el);
    if (s) return s;
    const cs = getComputedStyle(el), size = px(cs.fontSize);
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    let ul = el !== main && el.parentElement ? style(el.parentElement).look.ul : null;
    if ((cs.textDecorationLine || cs.textDecoration || '').includes('underline')) {
      const thick = parseFloat(cs.textDecorationThickness), off = parseFloat(cs.textUnderlineOffset);
      ul = { color: cs.textDecorationColor || cs.color, thick: thick >= 0 ? thick : max(1, size / 15), off: off === off ? off : size * 0.1 };
    }
    const id = `${font}|${cs.color}|${ul ? `${ul.color}/${ul.thick}/${ul.off}` : ''}`;
    let look = looks.get(id);
    if (!look) {
      pen.font = font;
      const m = pen.measureText('Hg'), asc = m.fontBoundingBoxAscent || size * 0.8, desc = m.fontBoundingBoxDescent || size * 0.2;
      // big type set tight spills over its advance box, so the margin around a glyph grows with the size
      looks.set(id, look = { id: looks.size, font, color: cs.color, ul, rise: asc / (asc + desc), pad: size < BIG / 2 ? 2 * ceil(dpr) : ceil(size * 0.12 * dpr) });
    }
    styles.set(el, s = { show: cs.visibility === 'visible', look, caps: cs.textTransform });
    return s;
  }

  // One sprite per (look, character, sub-pixel phase). The phase is baked in, so a piece at rest lands
  // on exactly the device pixels of the real glyph and the hand-over, both ways, is a cut nobody sees.
  function glyph(ch, r, look) {
    const L = r.left * dpr, T = r.top * dpr, fx = L - floor(L), base = (r.top + r.height * look.rise) * dpr - floor(T), PAD = look.pad;
    const w = ceil(r.width * dpr + fx) + 2 * PAD, h = ceil(r.height * dpr) + 1 + 2 * PAD;
    // rasterisers snap glyphs to quarter pixels, so that is how finely phases need telling apart
    const key = `${look.id}|${ch}|${round(fx * 4)}|${round(base * 4)}|${w}|${h}`;
    let sp = sprites.get(key);
    if (!sp) {
      const u0 = round(fx), u1 = round(fx + r.width * dpr);  // underline spans the whole advance so it tiles
      sprites.set(key, sp = {
        w, h, paint(c, x, y) {
          c.setTransform(dpr, 0, 0, dpr, x + PAD + fx, y + PAD + base);
          c.font = look.font;
          c.fillStyle = look.color;
          c.fillText(ch, 0, 0);
          if (!look.ul) return;
          c.setTransform(1, 0, 0, 1, x + PAD, y + PAD);
          c.fillStyle = look.ul.color;
          c.fillRect(u0, round(base + look.ul.off * dpr), u1 - u0, max(1, round(look.ul.thick * dpr)));
        },
      });
    }
    const x = floor(L) - PAD, y = floor(T) - PAD;
    if (r.height < BIG) { pieces.push({ sp, x: x + scrollX * dpr, y: y + scrollY * dpr, w, h, ox: 0, oy: 0, kind: 1 }); return; }
    // a headline letter: tiles that drift as one body (the group) until the pull takes them one by one
    const first = pieces.length, g = groups.push({ x: x + w / 2 + scrollX * dpr, y: y + h / 2 + scrollY * dpr }) - 1;
    tiles(sp, { x, y, w, h }, 1, max(12, r.height / 10));
    for (let k = first; k < pieces.length; k++) pieces[k].g = g;
  }

  function text(n, deadline) {
    const s = style(n.parentElement), data = n.data;
    if (!s.show) return true;
    for (; at < data.length; at++) {
      const code = data.charCodeAt(at);
      if ((code <= 32 || code === 160) && !s.look.ul) continue;  // blanks draw nothing unless underlined
      const len = code >= 0xd800 && code < 0xdc00 && at + 1 < data.length ? 2 : 1;
      range.setStart(n, at);
      range.setEnd(n, at + len);
      const rects = range.getClientRects();
      let ch = data.substr(at, len);  // text-transform: the node says Work, the screen says WORK
      if (s.caps === 'uppercase' || (s.caps === 'capitalize' && (!at || data.charCodeAt(at - 1) <= 32))) ch = ch.toUpperCase();
      else if (s.caps === 'lowercase') ch = ch.toLowerCase();
      for (let i = 0; i < rects.length; i++) {
        if (rects[i].width > 0.5 && rects[i].height > 0.5) { glyph(ch, rects[i], s.look); break; }
      }
      at += len - 1;
      if ((++count & 31) === 0 && now() > deadline) { at++; return false; }
    }
    at = 0;
    return true;
  }

  // A box (photo, icon, rule) is snapped to device pixels the way the browser snaps it, and cut into tiles.
  function box(el) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect(), edge = (side) => px(cs['border' + side + 'Width']) + px(cs['padding' + side]);
    const pic = el.localName === 'img', l = pic ? edge('Left') : 0, t = pic ? edge('Top') : 0;
    const x = round((r.left + l) * dpr), y = round((r.top + t) * dpr);
    const w = round((r.right - (pic ? edge('Right') : 0)) * dpr) - x, h = round((r.bottom - (pic ? edge('Bottom') : 0)) * dpr) - y;
    return cs.visibility === 'visible' && r.width >= 1 ? { cs, x, y, w, h: max(1, h) } : null;
  }
  function tiles(sp, b, kind, target, solid, rim) {
    let cols = max(1, round(b.w / (target * dpr))), rows = max(1, round(b.h / (target * dpr)));
    const over = sqrt(cols * rows / 1500);
    if (over > 1) { cols = ceil(cols / over); rows = ceil(rows / over); }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (rim && r > 0 && r < rows - 1 && c > 0 && c < cols - 1) continue;  // an outline has nothing inside
        const ax = round(c * b.w / cols), bx = round((c + 1) * b.w / cols), ay = round(r * b.h / rows), by = round((r + 1) * b.h / rows);
        const p = { sp, x: b.x + ax + scrollX * dpr, y: b.y + ay + scrollY * dpr, w: bx - ax, h: by - ay, ox: ax, oy: ay, kind };
        if (solid) { p.ox = p.oy = 2; p.uw = p.uh = 2; }
        pieces.push(p);
      }
    }
  }

  function picture(el) {
    const b = box(el), iw = el.naturalWidth, ih = el.naturalHeight;
    if (!b || !el.complete || !iw || b.w < 1) return;
    const { w, h } = b, fit = b.cs.objectFit;
    let dw = w, dh = h;  // object-fit: fill
    if (fit === 'cover' || fit === 'contain' || fit === 'scale-down') {
      let s = (fit === 'cover' ? max : min)(w / iw, h / ih);
      if (fit === 'scale-down') s = min(s, dpr);
      dw = iw * s; dh = ih * s;
    } else if (fit === 'none') { dw = iw * dpr; dh = ih * dpr; }
    const pos = b.cs.objectPosition.split(' '), place = (v, free) => (/%$/.test(v) ? free * parseFloat(v) / 100 : px(v) * dpr);
    const dx = place(pos[0] || '50%', w - dw), dy = place(pos[1] || '50%', h - dh), clean = untainted(el);
    const sp = {
      w, h, paint(c, x, y) {
        c.save();
        c.beginPath(); c.rect(x, y, w, h); c.clip();
        c.imageSmoothingEnabled = !/pixelated|crisp-edges/.test(b.cs.imageRendering);
        if (clean) c.drawImage(el, x + dx, y + dy, dw, dh);
        else { c.fillStyle = '#888'; c.fill(); }  // a cross-origin image would poison the atlas
        c.restore();
      },
    };
    sprites.set(sp, sp);
    tiles(sp, b, 0, 8);
  }

  // Inline svg: clone it, give the clone the colours the page's stylesheet resolved to (currentColor
  // included), and let the browser rasterise that as an image at device resolution.
  function vector(el) {
    const b = box(el);
    if (!b || b.w < 1) return;
    const copy = el.cloneNode(true), from = [el, ...el.querySelectorAll('*')], to = [copy, ...copy.querySelectorAll('*')];
    from.forEach((src, i) => {
      const s = getComputedStyle(src);
      for (const p of PAINT) to[i].style.setProperty(p, s.getPropertyValue(p));
    });
    copy.setAttribute('width', b.w);
    copy.setAttribute('height', b.h);
    const xml = new XMLSerializer().serializeToString(copy);
    let img = drawn.get(xml);
    if (!img) {
      if (drawn.size > 200) drawn.clear();
      drawn.set(xml, img = new Image());
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    }
    if (!img.complete) {
      const done = () => { pending--; };
      pending++;
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    }
    const sp = { w: b.w, h: b.h, paint(c, x, y) { if (img.naturalWidth) c.drawImage(img, x, y, b.w, b.h); } };
    sprites.set(sp, sp);
    tiles(sp, b, 1, 14);
  }

  function fill(color, x, y, w, h, kind) {
    if (w < 1 || h < 1) return;
    const key = 'fill|' + color;
    if (!sprites.has(key)) sprites.set(key, { w: 6, h: 6, paint(c, px0, py0) { c.fillStyle = color; c.fillRect(px0, py0, 6, 6); } });
    tiles(sprites.get(key), { x, y, w, h }, kind, 14, true);
  }

  function rule(el) {
    const b = box(el);
    if (b) fill(CLEAR.test(b.cs.backgroundColor) ? b.cs.borderTopColor : b.cs.backgroundColor, b.x, b.y, b.w, b.h, 1);
  }

  // Boxes: nav chips, tags, pills, a framed photo, every hairline. A background becomes a wash of tiles and
  // each border side a row of dashes. A box with properly round corners is painted whole and cut up instead.
  function frame(el) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    const sides = ['Top', 'Right', 'Bottom', 'Left'].map((side) => (cs['border' + side + 'Style'] === 'none' ? 0 : px(cs['border' + side + 'Width'])));
    const wash = !CLEAR.test(cs.backgroundColor);
    if ((!wash && !sides.some(Boolean)) || cs.visibility !== 'visible' || r.width < 1 || r.height < 1) return;
    const x = round(r.left * dpr), y = round(r.top * dpr), w = round(r.right * dpr) - x, h = round(r.bottom * dpr) - y;
    const [t, rt, bt, l] = sides.map((v) => (v ? max(1, round(v * dpr)) : 0));
    const curve = min(px(cs.borderTopLeftRadius) * dpr, w / 2, h / 2);
    if (curve >= 4 * dpr) {
      const line = t, ink = cs.borderTopColor, paper = cs.backgroundColor;
      const sp = {
        w, h, paint(c, px0, py0) {
          const round2 = (inset) => {
            const R = max(0, curve - inset), a = px0 + inset, b2 = py0 + inset, W = w - 2 * inset, H = h - 2 * inset;
            c.beginPath();
            c.moveTo(a + R, b2); c.arcTo(a + W, b2, a + W, b2 + H, R); c.arcTo(a + W, b2 + H, a, b2 + H, R);
            c.arcTo(a, b2 + H, a, b2, R); c.arcTo(a, b2, a + W, b2, R); c.closePath();
          };
          if (wash) { round2(0); c.fillStyle = paper; c.fill(); }
          if (line) { round2(line / 2); c.lineWidth = line; c.strokeStyle = ink; c.stroke(); }
        },
      };
      sprites.set(sp, sp);
      tiles(sp, { x, y, w, h }, wash ? 3 : 1, 14, false, !wash);
      return;
    }
    if (wash) fill(cs.backgroundColor, x, y, w, h, 3);
    fill(cs.borderTopColor, x, y, w, t, 1);
    fill(cs.borderBottomColor, x, y + h - bt, w, bt, 1);
    fill(cs.borderLeftColor, x, y + t, l, h - t - bt, 1);
    fill(cs.borderRightColor, x + w - rt, y + t, rt, h - t - bt, 1);
  }

  // Not rendered means not captured: display none, and whatever sits in a collapsed <details>. Chrome still
  // hands out rects for the latter, so asking for rects is no test.
  const rendered = (el) => (el.checkVisibility ? el.checkVisibility() || getComputedStyle(el).display === 'contents'
    : !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));

  // The cast that is not on the page: uh oh at bursting size (it shatters into shards) and a spark.
  const F = word.peak;
  for (const ch of new Set(WORD)) {
    sprites.set('word|' + ch, {
      w: ceil(word.wide[ch] * F * dpr) + 2 * PAD, h: ceil(F * 1.3 * dpr) + 2 * PAD, paint(c, x, y) {
        c.setTransform(dpr, 0, 0, dpr, x + PAD, y + PAD + F * dpr);
        c.font = `600 ${F}px ${word.family}`;
        c.fillStyle = '#fff';
        c.fillText(ch, 0, 0);
      },
    });
  }
  sprites.set('spark', {
    w: 16, h: 16, paint(c, x, y) {
      const g = c.createRadialGradient(x + 8, y + 8, 0, x + 8, y + 8, 8);
      g.addColorStop(0, '#fff'); g.addColorStop(0.35, 'rgba(255,255,255,.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(x, y, 16, 16);
    },
  });

  return {
    sprites, pieces, groups,
    step(deadline) {  // true once everything has been measured and every svg has decoded
      while (node) {
        if (node.nodeType === 3) {
          const host = node.parentElement;
          if (!(host.localName === 'details' && !host.open) && !text(node, deadline)) return false;
          node = next(node, true);
        } else if (node.nodeType === 1 && node !== main) {
          const tag = node.localName;
          const draw = !rendered(node) ? null : tag === 'img' ? picture : tag === 'svg' ? vector : tag === 'hr' ? rule : frame;
          if (draw) draw(node);
          node = next(node, draw !== frame);  // only a plain box has anything inside worth visiting
        } else node = next(node, node !== main);
        if (now() > deadline) return false;
      }
      return pending === 0;
    },
  };
}

function untainted(img) {
  try {
    const g = doc.createElement('canvas').getContext('2d');
    g.drawImage(img, 0, 0, 1, 1);
    g.getImageData(0, 0, 1, 1);
    return true;
  } catch (e) { return false; }
}

// Shelf-pack the sprites and paint them: one texture for the whole page.
function atlas(sprites, limit) {
  const list = [...sprites.values()].sort((a, b) => b.h - a.h);
  const widest = max(...list.map((s) => s.w + 2));
  const pack = (W) => {  // shelves, tallest first; returns the height it took
    let x = 1, y = 1, row = 0;
    for (const s of list) {
      if (x + s.w + 1 > W) { x = 1; y += row + 1; row = 0; }
      s.ax = x; s.ay = y;
      x += s.w + 1;
      row = max(row, s.h);
    }
    return y + row + 1;
  };
  // 2048 wide is plenty for most pages; headline type on a retina screen gets the full width
  let W = min(limit, max(2048, widest)), H = pack(W);
  if (H > limit && W < limit) H = pack(W = limit);
  if (H > limit) throw new Error('fx: this page does not fit one texture');
  const c = doc.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  for (const s of list) { g.setTransform(1, 0, 0, 1, 0, 0); s.paint(g, s.ax, s.ay); }
  return c;
}

// ---- the cast: one slot per piece, typed arrays
const HOME = 0, ADRIFT = 1, FALLING = 2, DISK = 3, GONE = 4;
let P = null;

function cast(cap, tex, dpr) {
  const page = cap.pieces, nPage = page.length, n = nPage + EXTRAS, f = () => new Float32Array(n);
  const p = {
    n, nPage, front: 0, alive: n,
    fixed: new Float32Array(n * 7),  // gpu, once: w, h, kind, u0, v0, u1, v1
    live: new Float32Array(n * 8),  // gpu, every frame: x, y, rotation, scale, stretch x, stretch y, heat, alpha
    state: new Uint8Array(n),
    hx: f(), hy: f(),  // home (document css px, centre of the sprite)
    x: f(), y: f(), vx: f(), vy: f(), rot: f(), spin: f(), size: f(), glow: f(), frail: f(),
    mark: f(),  // a time: when the shockwave arrives, when it let go, when it joined the disk
    rho: f(), phi: f(), tilt: f(),  // orbit in the disk; during the restore, the route home
    a: f(), b: f(), c: f(),  // pose at release: scale, heat, alpha
    seed: f(), dice: f(),
    grp: new Int32Array(n).fill(-1), offx: f(), offy: f(),  // the headline letter a tile belongs to, and where in it
    G: null,
  };
  const nG = cap.groups.length, gf = () => new Float32Array(nG);
  const G = p.G = { n: nG, hx: gf(), hy: gf(), x: gf(), y: gf(), vx: gf(), vy: gf(), rot: gf(), spin: gf(), mark: gf(), glow: gf(), seed: gf(), dice: gf(), adrift: new Uint8Array(nG) };
  cap.groups.forEach((q, g) => { G.hx[g] = q.x / dpr; G.hy[g] = q.y / dpr; G.seed[g] = random(); G.dice[g] = random(); });
  const put = (i, sp, q) => {
    const o = i * 7, u = sp.ax + q.ox, v = sp.ay + q.oy;
    p.fixed[o] = q.w / dpr; p.fixed[o + 1] = q.h / dpr; p.fixed[o + 2] = q.kind;
    p.fixed[o + 3] = u / tex.width; p.fixed[o + 4] = v / tex.height;
    p.fixed[o + 5] = (u + (q.uw || q.w)) / tex.width; p.fixed[o + 6] = (v + (q.uh || q.h)) / tex.height;
    p.seed[i] = random(); p.dice[i] = random();
  };
  let i = 0;
  for (; i < nPage; i++) {
    const q = page[i];
    put(i, q.sp, q);
    p.hx[i] = (q.x + q.w / 2) / dpr;
    p.hy[i] = (q.y + q.h / 2) / dpr;
    if (q.g >= 0) { p.grp[i] = q.g; p.offx[i] = p.hx[i] - G.hx[q.g]; p.offy[i] = p.hy[i] - G.hy[q.g]; }
  }
  // shards: each letter of uh oh in a 4x6 grid; hx/hy hold the offset from the letter's centre
  for (const ch of WORD) {
    const sp = cap.sprites.get('word|' + ch);
    for (let j = 0; j < SHARDS; j++, i++) {
      const c = j % 4, r = j >> 2, x0 = round(c * sp.w / 4), x1 = round((c + 1) * sp.w / 4), y0 = round(r * sp.h / 6), y1 = round((r + 1) * sp.h / 6);
      put(i, sp, { w: x1 - x0, h: y1 - y0, ox: x0, oy: y0, kind: 2 });
      p.hx[i] = ((x0 + x1) / 2 - sp.w / 2) / dpr;
      p.hy[i] = ((y0 + y1) / 2 - sp.h / 2) / dpr;
    }
  }
  for (const dot = cap.sprites.get('spark'); i < n; i++) {
    const s = (2.5 + 5 * random() * random()) * dpr;
    put(i, dot, { w: s, h: s, ox: 0, oy: 0, uw: 16, uh: 16, kind: 2 });
  }
  return p;
}

// ---- shaders
const PRECISION = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
// How dark it is at offset q (css px, y down) from a hole whose night has radius r, t seconds after the
// bang. The dark does not spread evenly: it comes out in two trailing arms that turn with the hole.
const NIGHT = `float night(vec2 q, float r, float t) {
  float d = length(q);
  if (d > 1.) d *= 1. + .14 * sin(2. * atan(q.y, q.x) - 4. * log(d + 30.) + t * 2.5);
  return 1. - smoothstep(r * .3, r, d);
}
`;
const VS_FULL = 'attribute vec2 aCorner; void main() { gl_Position = vec4(aCorner * 2., 0., 1.); }';

const VS_PIECE = `
attribute vec2 aCorner;   // -0.5 .. 0.5
attribute vec4 aUV;       // atlas rect: u0 v0 u1 v1
attribute vec3 aBox;      // width, height (css px), kind: 0 picture, 1 ink, 2 ember (shards and sparks), 3 wash (a background)
attribute vec4 aPose;     // x, y (document css px), rotation, scale
attribute vec4 aLook;     // stretch (direction and amount), heat (+2: in front of the hole), alpha
uniform vec2 uView, uCam;
uniform vec3 uHole;       // centre (document css px), radius of the night around it
uniform float uTint, uLayer, uTime;
varying vec2 vUV;
varying vec4 vLook;       // heat, how far the ink has turned to ember, alpha, kind
${NIGHT}
void main() {
  float heat = aLook.z, layer = 0.;
  if (heat >= 2.) { heat -= 2.; layer = 1.; }
  vec2 p = aCorner * aBox.xy * aPose.w;
  float c = cos(aPose.z), s = sin(aPose.z);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  float k = length(aLook.xy);
  if (k > .001) {                       // spaghettify: longer along the pull, thinner across it
    vec2 d = aLook.xy / k;
    float along = dot(p, d);
    p = d * along * (1. + k) + (p - d * along) / sqrt(1. + k);
  }
  vec2 at = (aPose.xy + p - uCam) / uView;
  gl_Position = layer == uLayer && aLook.w > 0. ? vec4(at.x * 2. - 1., 1. - at.y * 2., 0., 1.) : vec4(2., 2., 2., 1.);
  float dark = night(aPose.xy - uHole.xy, uHole.z, uTime);
  float turned = aBox.z > 2.5 ? max(dark, smoothstep(.08, .4, heat)) : aBox.z > 1.5 ? 1. : aBox.z > .5 ? max(dark, smoothstep(.08, .4, heat)) : smoothstep(.35, .9, heat);
  vUV = mix(aUV.xy, aUV.zw, aCorner + .5);
  vLook = vec4(heat, turned * uTint, aLook.w, aBox.z);
}`;

const FS_PIECE = `${PRECISION}
uniform sampler2D uAtlas;
varying vec2 vUV;
varying vec4 vLook;
vec3 ember(float h) {       // deep brown, amber, pale gold, warm white
  vec3 c = mix(vec3(.26, .13, .05), vec3(.62, .30, .08), smoothstep(.0, .3, h));
  c = mix(c, vec3(1., .55, .14), smoothstep(.28, .55, h));
  c = mix(c, vec3(1., .84, .52), smoothstep(.52, .8, h));
  return mix(c, vec3(1., .97, .90), smoothstep(.78, 1., h));
}
void main() {
  vec4 t = texture2D(uAtlas, vUV);       // premultiplied
  if (vLook.w > 2.5) { gl_FragColor = t * vLook.z * (1. - vLook.y); return; }   // a wash does not glow, it goes out
  vec3 hot = ember(max(vLook.x, .15));
  // ink simply becomes ember; a picture keeps its colours until it is properly hot, then it is light too
  vec3 lit = vLook.w < .5 ? hot * (dot(t.rgb, vec3(.3, .59, .11)) * .8 + t.a * .2) : hot * t.a;
  float add = smoothstep(.55, 1., vLook.x) * vLook.y * .8;     // white-hot pieces add up instead of covering each other
  gl_FragColor = vec4(mix(t.rgb, lit, vLook.y), t.a * (1. - add)) * vLook.z;
}`;

// The night around the hole and, for half a second, the bang: fireball and shockwave.
const FS_VEIL = `${PRECISION}
uniform vec2 uC;          // hole centre (device px, y up)
uniform vec3 uB;          // bang centre (device px, y up), half the width of the word that burst (css px)
uniform float uRatio;     // device px per css px
uniform vec4 uVeil;       // night radius (css px), fade, seconds since the bang, shockwave radius (css px)
${NIGHT}
void main() {
  float a = night((gl_FragCoord.xy - uC) * vec2(1., -1.) / uRatio, uVeil.x, uVeil.z);
  vec3 c = vec3(0.);
  float tb = uVeil.z;
  if (tb < .7) {
    vec2 q = (gl_FragCoord.xy - uB.xy) / uRatio;
    float d = length(q), grown = 1. - exp(-tb * 22.);
    // fireball: starts as wide as the word, rounds off as it grows, gone in a blink
    float df = length(q / vec2(mix(uB.z / 45., 1.25, grown), 1.));
    float f = exp(-tb * 14.) * pow(max(0., 1. - df / (45. + 200. * grown)), 1.3), fa = smoothstep(0., .22, f);
    vec3 fire = mix(vec3(.75, .12, .0), vec3(1., .50, .05), smoothstep(.0, .3, f));
    fire = mix(fire, vec3(1., .86, .35), smoothstep(.25, .6, f));
    c = mix(fire, vec3(1., .98, .9), smoothstep(.6, .95, f)) * fa;
    a += fa - a * fa;
    // shockwave: a thin hot line with a bruise behind it, so it reads on white and on black
    float w = 3. + uVeil.w * .012, x = (d - uVeil.w) / w, life = exp(-uVeil.w / 480.);
    float line = exp(-x * x) * life, wake = d < uVeil.w ? exp((d - uVeil.w) / (w * 3.)) * life * .28 : 0.;
    c = c * (1. - line) + vec3(1., .62, .25) * line;
    a += (line + wake) * (1. - a);
  }
  gl_FragColor = vec4(c, a) * uVeil.y;
}`;

// Gargantua. Every pixel is a light ray traced backwards from the eye through Schwarzschild space: the
// bending term is exact for a photon, acceleration = -1.5 h^2 r / |r|^5 with h = |r x v|, in units of
// the Schwarzschild radius. Where a ray crosses the plane of the disk it picks up the disk's light; a
// ray that ends inside the horizon is the shadow. The arc over the top is the far side of the disk,
// seen over the hole; the thin one below is its underside. Nothing here is painted on.
const FS_HOLE = `${PRECISION}
uniform vec2 uC;          // centre (device px, y up)
uniform float uUnit;      // device px per Schwarzschild radius
uniform float uT;         // seconds, wraps every 120
uniform float uFeed;      // 0..1: how much it has eaten. The disk is made of it.
uniform float uFade;
const float INCL = ${FLAT};     // the eye sits this far (radians) above the plane of the disk
const float R_IN = 2., R_OUT = 11.;
const float B_CRIT = 2.598;     // rays aimed closer than this never come back: the edge of the shadow
const float CYCLE = 2.4;        // s. uT wraps after a whole number of these, so the film has no seam
const int STEPS = 80;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p, float wrap) {      // value noise, periodic in y so the angle can wrap
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  float y0 = mod(i.y, wrap), y1 = mod(i.y + 1., wrap);
  return mix(mix(hash(vec2(i.x, y0)), hash(vec2(i.x + 1., y0)), f.x), mix(hash(vec2(i.x, y1)), hash(vec2(i.x + 1., y1)), f.x), f.y);
}
float streaks(float r, float turn) {   // fine in radius, long in angle
  return .50 * noise(vec2(r * 2.3, turn * 5.), 5.) + .32 * noise(vec2(r * 5.9 + 7., turn * 11.), 11.)
    + .18 * noise(vec2(r * 13. + 3., turn * 23.), 23.);
}
// What a ray picks up where it crosses the disk: light, and how much of what lies behind it is hidden.
vec4 disk(float r, float turn, float graze, float approach, float feed) {
  float rOut = mix(R_IN + 2., R_OUT, feed), x = (r - R_IN) / (rOut - R_IN);
  if (x <= 0. || x >= 1.) return vec4(0.);
  // Keplerian: the inside laps the outside. Two copies of the pattern half a cycle apart are cross-faded,
  // so the shear never winds up further than one cycle, however long the button is held.
  float w = .775 * pow(R_OUT / r, 1.5) / 6.2831853;
  float f0 = fract(uT / CYCLE), f1 = fract(f0 + .5);
  float n = mix(streaks(r, turn + w * (f0 - .5) * CYCLE), streaks(r + 31.7, turn + w * (f1 - .5) * CYCLE), abs(2. * f0 - 1.));
  float edge = smoothstep(0., .05, x) * (1. - smoothstep(.35, 1., x));
  // a thin glowing sheet: the shallower a ray cuts through it, the more it collects. That is why the
  // edge-on band blazes while the lensed arcs, seen more face-on, stay soft.
  float slant = pow(1. / max(abs(graze), .13), .6);
  float t = pow(R_IN / r, .85) * (.22 + 1.1 * n * n) * edge * slant * .6;        // "temperature"
  vec3 col = mix(mix(vec3(.22, .06, .012), vec3(.95, .48, .13), smoothstep(.02, .2, t)),
    mix(vec3(1., .82, .52), vec3(1., .96, .88), smoothstep(.4, .85, t)), smoothstep(.15, .42, t));
  // the side that comes towards us is a little brighter. The film kept that subtle, so do we.
  return vec4(col * t * (1. + .18 * approach) * 2., clamp(edge * (.15 + .6 * n) * slant, 0., .95));
}
void main() {
  vec2 p = (gl_FragCoord.xy - uC) / uUnit;
  float b2 = dot(p, p), b = sqrt(b2), feed = sqrt(uFeed), gain = .06 + .94 * feed, px = 1. / uUnit;
  float rOut = mix(R_IN + 2., R_OUT, feed), bound = length(p / vec2(rOut + 2.5, 7.5));
  if (bound > 1.) { gl_FragColor = vec4(0.); return; }
  vec3 N = vec3(0., cos(INCL), -sin(INCL)), E2 = vec3(0., -sin(INCL), -cos(INCL));
  vec3 pos = vec3(p, -(R_OUT + 3.)), vel = vec3(0., 0., 1.);     // parallel rays, starting just outside the disk
  vec3 col = vec3(0.);
  float A = 0., haze = 0., side = dot(pos, N);
  for (int i = 0; i < STEPS; i++) {
    float r2 = dot(pos, pos), r = sqrt(r2);
    if (r < 1. || A > .98) break;
    float dt = clamp(.15 * r, .04, 2.);
    vel -= 1.5 * b2 * pos / (r2 * r2 * r) * dt;
    vec3 np = pos + vel * dt;
    float s = dot(np, N);
    if (s * side < 0.) {                                          // crossed the plane of the disk
      vec3 hit = mix(pos, np, side / (side - s)), dir = normalize(vel);
      float turn = atan(dot(hit, E2), hit.x) / 6.2831853 + .5;
      vec4 e = disk(length(hit), turn, dot(dir, N), dot(normalize(cross(hit, N)), -dir), feed) * gain;
      col += (1. - A) * e.rgb;
      A += (1. - A) * e.a;
    }
    // a thin haze hugging the disk: the bloom, bent by the same gravity as everything else
    float hz = smoothstep(R_IN - .6, R_IN + .4, r) * (1. - smoothstep(rOut * .5, rOut, r));
    haze += (1. - A) * hz * exp(-abs(s) * 2.8) * (R_IN / r) * dt * .2 * gain;
    pos = np; side = s;
    if (r2 > 400. && dot(pos, vel) > 0.) break;
  }
  // The shadow has an analytic edge, so it is black and round at any size. The photon ring sits right
  // on it, razor thin: light that went round the back at the last possible radius.
  float shadow = 1. - smoothstep(B_CRIT - px, B_CRIT + px, b);
  float ring = exp(-pow((b - B_CRIT * 1.012) / (.024 + px), 2.));
  col += (1. - A) * ring * vec3(1., .93, .80) * 1.7 * (.45 + .55 * gain);
  float glow = (haze + .09 * gain / (1. + b2 * .07) + .035 / (1. + b2 * .3)) * (1. - smoothstep(.3, 1., bound)) * (1. - shadow);
  col += (1. - A) * glow * vec3(1., .74, .45);
  gl_FragColor = vec4(1. - exp(-col * 1.2), A + (1. - A) * shadow) * uFade;
}`;

// ---- gl
let canvas = null, gl = null, G = null;  // G: programs, buffers, the draw-instanced call
let noGL = false;
const view = { w: 0, h: 0, dpr: 1, q: 1 };  // q: resolution scale, lowered if this machine cannot keep up

function initGL() {
  const c = doc.createElement('canvas');
  const opt = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false };
  const g = c.getContext('webgl2', opt) || c.getContext('webgl', opt);
  const two = !!g && typeof WebGL2RenderingContext !== 'undefined' && g instanceof WebGL2RenderingContext;
  const ext = g && !two && g.getExtension('ANGLE_instanced_arrays');
  if (!g || (!two && !ext)) return false;

  // Compile and link without asking how it went: the answer blocks until the driver is done, and the
  // ray marcher can take a while the first time. ready() polls instead, so uh oh keeps moving meanwhile.
  const parallel = g.getExtension('KHR_parallel_shader_compile');
  const build = (vs, fs, attribs) => {
    const p = g.createProgram(), shaders = [[g.VERTEX_SHADER, vs], [g.FRAGMENT_SHADER, fs]].map(([type, src]) => {
      const s = g.createShader(type);
      g.shaderSource(s, src);
      g.compileShader(s);
      g.attachShader(p, s);
      return s;
    });
    attribs.forEach((name, i) => g.bindAttribLocation(p, i, name));
    g.linkProgram(p);
    return { p, shaders, u: null };
  };
  const ready = () => {
    for (const prog of [G.piece, G.veil, G.hole]) {
      if (prog.u) continue;
      if (parallel && !g.getProgramParameter(prog.p, parallel.COMPLETION_STATUS_KHR)) return false;
      if (!g.getProgramParameter(prog.p, g.LINK_STATUS)) {
        throw new Error('fx shader: ' + g.getProgramInfoLog(prog.p) + prog.shaders.map((s) => g.getShaderInfoLog(s)).join(''));
      }
      prog.u = {};
      for (let i = g.getProgramParameter(prog.p, g.ACTIVE_UNIFORMS) - 1; i >= 0; i--) {
        const name = g.getActiveUniform(prog.p, i).name;
        prog.u[name] = g.getUniformLocation(prog.p, name);
      }
    }
    return true;
  };
  const buffer = (data) => {
    const b = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, b);
    if (data) g.bufferData(g.ARRAY_BUFFER, data, g.STATIC_DRAW);
    return b;
  };
  const attrib = (i, size, stride, offset, instanced) => {
    g.enableVertexAttribArray(i);
    g.vertexAttribPointer(i, size, g.FLOAT, false, stride, offset);
    if (instanced) two ? g.vertexAttribDivisor(i, 1) : ext.vertexAttribDivisorANGLE(i, 1);
  };
  G = {
    ready,
    piece: build(VS_PIECE, FS_PIECE, ['aCorner', 'aUV', 'aBox', 'aPose', 'aLook']),
    veil: build(VS_FULL, FS_VEIL, ['aCorner']),
    hole: build(VS_FULL, FS_HOLE, ['aCorner']),
    limit: min(4096, g.getParameter(g.MAX_TEXTURE_SIZE)),
    instances: two ? (n) => g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, n) : (n) => ext.drawArraysInstancedANGLE(g.TRIANGLE_STRIP, 0, 4, n),
  };
  buffer(new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]));  // one quad serves every pass
  attrib(0, 2, 0, 0);
  G.fixed = buffer();
  attrib(2, 3, 28, 0, true);
  attrib(1, 4, 28, 12, true);
  G.live = buffer();
  attrib(3, 4, 32, 0, true);
  attrib(4, 4, 32, 16, true);
  g.bindTexture(g.TEXTURE_2D, g.createTexture());
  for (const [k, v] of [[g.TEXTURE_MIN_FILTER, g.LINEAR], [g.TEXTURE_MAG_FILTER, g.LINEAR], [g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE], [g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE]]) g.texParameteri(g.TEXTURE_2D, k, v);
  g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  g.enable(g.BLEND);
  g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);  // premultiplied everywhere
  // A lost context is one more way out: put the page back, start from scratch next time.
  c.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (canvas !== c) return;
    bail(false);
    c.remove();
    canvas = gl = G = null;
  });
  overlay().insertBefore(c, overlay().firstChild);
  canvas = c; gl = g;
  return true;
}

function fitCanvas(q) {
  view.w = overlay().clientWidth; view.h = overlay().clientHeight;
  const W = round(view.w * view.dpr * q), H = round(view.h * view.dpr * q);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
}

const hole = { x: 0, y: 0, r: 0, v: 0, S: 60, feed: 0, dark: 0 };
const bang = { x: 0, y: 0, t: 0, wide: 0 };

// One frame. t: seconds since the bang; fade: 1, or less while everything is put back.
function render(t, fade, warmup) {
  const g = gl, W = canvas.width, H = canvas.height, k = W / view.w;
  const jolt = t < 0.6 ? 10 * exp(-t * 9) : 0;  // the camera takes the bang too
  const camX = scrollX + (random() - 0.5) * jolt, camY = scrollY + (random() - 0.5) * jolt;
  const cx = (hole.x - camX) * k, cy = H - (hole.y - camY) * k;
  const reach = hypot(max(hole.x - camX, view.w - hole.x + camX), max(hole.y - camY, view.h - hole.y + camY));
  const night = !warmup && t > 0.7 && hole.dark * 0.25 > reach;  // the dark has covered the screen: no veil pass needed
  g.viewport(0, 0, W, H);
  if (warmup) { g.enable(g.SCISSOR_TEST); g.scissor(0, 0, 2, 2); } else g.disable(g.SCISSOR_TEST);
  g.clearColor(0, 0, 0, night ? fade : 0);
  g.clear(g.COLOR_BUFFER_BIT);
  if (!night) {
    g.useProgram(G.veil.p);
    g.uniform2f(G.veil.u.uC, cx, cy);
    g.uniform3f(G.veil.u.uB, (bang.x - camX) * k, H - (bang.y - camY) * k, bang.wide);
    g.uniform1f(G.veil.u.uRatio, k);
    g.uniform4f(G.veil.u.uVeil, hole.dark, fade, t, WAVE * t);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
  }
  g.bindBuffer(g.ARRAY_BUFFER, G.live);
  g.bufferSubData(g.ARRAY_BUFFER, 0, P.live);
  const pieces = (layer) => {
    const u = G.piece.u;
    g.useProgram(G.piece.p);
    g.uniform2f(u.uView, view.w, view.h);
    g.uniform2f(u.uCam, camX, camY);
    g.uniform3f(u.uHole, hole.x, hole.y, hole.dark);
    g.uniform1f(u.uTint, fade);
    g.uniform1f(u.uLayer, layer);
    g.uniform1f(u.uTime, t);
    G.instances(P.n);
  };
  if (P.alive || warmup) pieces(0);  // everything behind the hole
  if (hole.r > 0.3 || warmup) {
    const unit = max(hole.r, 0.3) / SHADOW * k;
    const x0 = max(0, floor(cx - 16.6 * unit)), x1 = min(W, ceil(cx + 16.6 * unit));
    const y0 = max(0, floor(cy - 7.6 * unit)), y1 = min(H, ceil(cy + 7.6 * unit));
    if (x1 > x0 && y1 > y0) {
      if (!warmup) { g.enable(g.SCISSOR_TEST); g.scissor(x0, y0, x1 - x0, y1 - y0); }
      g.useProgram(G.hole.p);
      g.uniform2f(G.hole.u.uC, cx, cy);
      g.uniform1f(G.hole.u.uUnit, unit);
      g.uniform1f(G.hole.u.uT, t % 120);
      g.uniform1f(G.hole.u.uFeed, hole.feed);
      g.uniform1f(G.hole.u.uFade, fade);
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
      if (!warmup) g.disable(g.SCISSOR_TEST);
    }
  }
  if (P.front || warmup) pieces(1);  // the near side of the disk passes in front
}

// ---- the bang
let fed = 0, done = 0;

function explode() {
  const p = P, w = word, bx = w.x + scrollX, by = w.y + scrollY, k = w.size / w.peak;
  bang.x = hole.x = bx; bang.y = hole.y = by; bang.wide = w.size * 2.9;
  hole.r = hole.v = hole.feed = hole.dark = 0;
  // radius of the shadow once it is fed: as big as its dinner, as long as the disk still fits the window
  hole.S = max(24, min(view.w / 9.5, view.h / 5, 30 + sqrt(p.nPage)));
  fed = done = 0;
  p.front = 0; p.alive = p.n;
  for (let g = 0, G = p.G; g < G.n; g++) {
    G.x[g] = G.hx[g]; G.y[g] = G.hy[g];
    G.vx[g] = G.vy[g] = G.rot[g] = G.spin[g] = G.glow[g] = G.adrift[g] = 0;
    G.mark[g] = hypot(G.hx[g] - bx, G.hy[g] - by) / WAVE;
  }
  for (let i = 0, o = 0; i < p.n; i++, o += 8) {
    const j = i - p.nPage, a = random() * TAU;
    let x = p.hx[i], y = p.hy[i], speed = 0;
    p.rot[i] = p.spin[i] = p.vx[i] = p.vy[i] = p.glow[i] = p.frail[i] = 0;
    p.size[i] = 1;
    p.state[i] = j < 0 ? HOME : ADRIFT;
    if (j < 0) p.mark[i] = hypot(x - bx, y - by) / WAVE;  // when the shockwave gets here
    else if (j < WORD.length * SHARDS) {  // a shard of a letter, thrown from where that letter was
      const pose = w.pose[floor(j / SHARDS)];
      x = bx + pose.x + x * k * pose.sx; y = by + pose.y + y * k * pose.sy;
      const dx = (x - bx) / w.size * 0.35 + cos(a), dy = (y - by) / w.size * 1.5 + sin(a), d = hypot(dx, dy) || 1;
      speed = 200 + 1200 * random();
      p.vx[i] = dx / d * speed; p.vy[i] = dy / d * speed;
      p.spin[i] = (random() - 0.5) * 30;
      p.glow[i] = 0.7;
      p.frail[i] = 1.3 + random();
      p.size[i] = k;
    } else {  // a spark
      x = bx + (random() - 0.5) * w.size * 3; y = by + (random() - 0.5) * w.size * 0.6;
      speed = 300 + 2300 * random() * random();
      p.vx[i] = cos(a) * speed; p.vy[i] = sin(a) * speed;
      p.glow[i] = 0.85;
    }
    p.x[i] = x; p.y[i] = y;
    p.live.set([x, y, 0, p.size[i], 0, 0, p.glow[i], 1], o);
  }
}

// ---- the hole eats
// t: seconds since the bang. Pieces go HOME -> ADRIFT (kicked by the shockwave) -> FALLING (the pull has
// reached them; they steer onto an inward spiral) -> DISK (bound, tipping over into the plane of the
// disk, turning to light) -> GONE.
const shoved = { vx: 0, vy: 0, spin: 0, glow: 0 };
function shove(dx, dy, a, b) {  // the shockwave arrives: a push outward, a bit of spin, a flush of heat
  const d = hypot(dx, dy) || 1, j = 620 * exp(-d / 360) * (0.5 + a);
  shoved.vx = dx / d * j + (b - 0.5) * j * 0.5;
  shoved.vy = dy / d * j + (a - 0.5) * j * 0.5;
  shoved.spin = (b - 0.5) * j * 0.03;
  shoved.glow = 0.62 * exp(-d / 500);
}

function simulate(t, dt) {
  const p = P, { n, nPage, live, x, y, vx, vy, rot, spin, glow, mark, rho, phi, tilt, state, seed, dice, grp, offx, offy, G } = p;
  const th = min(t - OPEN, 12), mass = fed / max(1, nPage);
  if (th > 0) {
    // it follows the cursor, with more reluctance the more it has eaten
    const k = 1 - exp(-dt * mix(14, 6, mass));
    hole.x += (mouse.x + scrollX - hole.x) * k;
    hole.y += (mouse.y + scrollY - hole.y) * k;
    // and it is as big as its dinner, on a spring so every gulp shows. With the plate empty it keeps creeping.
    const creep = done ? 0.16 * (1 - exp(-(t - done) / 18)) : 0;
    const want = hole.S * (0.15 + 0.07 * (1 - exp(-th)) + 0.78 * pow(mass, 0.6)) * (1 + creep);
    hole.v += ((want - hole.r) * 80 - hole.v * 9) * dt;
    hole.r = max(0, hole.r + hole.v * dt);
  }
  hole.feed += (mass - hole.feed) * (1 - exp(-dt * 1.5));
  const front = th > 0 ? 60 * (exp(th / 0.75) - 1) : 0;  // how far the pull has reached: slow, then everything
  hole.dark = th > 0 ? 50 * (1 - exp(-th * 6)) + front * 1.6 : 0;  // the night runs a little ahead of it
  const hx = hole.x, hy = hole.y, R = hole.r, grow = R / hole.S;
  const gm = pow(300 * (0.4 + 0.6 * grow), 2) * 400;  // swirl: 300px/s at 400px once it is fully grown
  const inner = R * 1.15, hot = R * 6 + 150;
  let alive = 0, inFront = 0;

  // headline letters: each one a body that drifts on its own, whatever becomes of its tiles
  for (let g = 0; g < G.n; g++) {
    if (!G.adrift[g]) {
      if (t < G.mark[g]) continue;
      shove(G.x[g] - bang.x, G.y[g] - bang.y, G.seed[g], G.dice[g]);
      G.vx[g] = shoved.vx; G.vy[g] = shoved.vy; G.spin[g] = shoved.spin; G.glow[g] = shoved.glow; G.adrift[g] = 1;
    }
    const drag = exp(-dt * 3);
    G.vx[g] *= drag; G.vy[g] *= drag; G.spin[g] *= exp(-dt * 1.2);
    G.x[g] += G.vx[g] * dt; G.y[g] += G.vy[g] * dt; G.rot[g] += G.spin[g] * dt;
  }

  for (let i = 0, o = 0; i < n; i++, o += 8) {
    let s = state[i];
    if (s === GONE) continue;
    alive++;
    const g = grp[i];
    let held = false;  // still part of its letter: it goes where the letter goes
    if (s === HOME) {
      if (g >= 0) {
        if (!G.adrift[g]) continue;
        glow[i] = G.glow[g];
      } else {
        if (t < mark[i]) continue;
        shove(x[i] - bang.x, y[i] - bang.y, seed[i], dice[i]);
        vx[i] = shoved.vx; vy[i] = shoved.vy; spin[i] = shoved.spin; glow[i] = shoved.glow;
      }
      s = state[i] = ADRIFT;
    }
    const age = t * p.frail[i];  // shards burn out; nothing else does
    let px = x[i], py = y[i], heat = glow[i], alpha = sat(1.6 - age), scale = p.size[i] * (1 - 0.5 * sat(age)), sx = 0, sy = 0, layer = 0;
    glow[i] *= exp(-dt * 2.2);
    const dx = hx - px, dy = hy - py, r = sqrt(dx * dx + dy * dy) || 0.001, ux = dx / r, uy = dy / r;

    if (s === ADRIFT) {
      if (g >= 0) {
        const c = cos(G.rot[g]), sn = sin(G.rot[g]), w = G.spin[g];
        px = G.x[g] + c * offx[i] - sn * offy[i]; py = G.y[g] + sn * offx[i] + c * offy[i];
        vx[i] = G.vx[g] - w * (py - G.y[g]); vy[i] = G.vy[g] + w * (px - G.x[g]);
        rot[i] = G.rot[g]; spin[i] = w;
        held = true;
      } else {
        const drag = exp(-dt * 3);
        vx[i] *= drag; vy[i] *= drag; spin[i] *= exp(-dt * 1.2);
      }
      const speed = hypot(vx[i], vy[i]), blur = min(1.6, speed / 800) / (speed || 1);
      sx = vx[i] * blur; sy = vy[i] * blur;
      // a loose piece goes when its turn comes; a letter is eaten from the side that faces the hole
      if (r < front * (held ? 0.96 + 0.08 * seed[i] : 0.78 + 0.44 * seed[i])) { s = state[i] = FALLING; mark[i] = t; held = false; }
    }
    if (s === FALLING) {
      const grip = min(1, (t - mark[i]) / 0.5), pull = grip * grip;  // slow to let go of the page, then it goes
      const vin = (70 + r / 0.8) * (0.8 + 0.4 * dice[i]);
      // sideways is what makes it a spiral: Kepler close in, and far out never less than the inward
      // speed, so what comes from beyond the screen arrives as an arm and not as a jet
      const vt = max(sqrt(gm / max(r, 24)), vin * 0.8) * (0.65 + 0.7 * seed[i]);
      const steer = 1 - exp(-dt * 4 * pull), drag = exp(-dt * 3 * (1 - pull));
      const swing = vy[i] * ux - vx[i] * uy, bend = swing * swing / r * dt;  // what keeps an orbit an orbit
      vx[i] = vx[i] * drag + (ux * vin - uy * vt - vx[i]) * steer + ux * bend;
      vy[i] = vy[i] * drag + (uy * vin + ux * vt - vy[i]) * steer + uy * bend;
      spin[i] += ((seed[i] - 0.5) * (3 + 1000 / (r + 40)) - spin[i]) * (1 - exp(-dt * 3)) * pull;
      heat = max(heat, min(1, 1.12 - r / hot), 0.2);
      // taffy: it leans towards the hole while it is still hanging on, then stretches along its flight
      const speed = hypot(vx[i], vy[i]), lean = sin(grip * PI) * 0.55, fly = min(1.7, speed / 700) * pull / (speed || 1);
      sx = ux * lean + vx[i] * fly; sy = uy * lean + vy[i] * fly;
      if (r < R * (4.2 + 1.6 * seed[i]) + 8) {  // bound. It is disk now.
        s = state[i] = DISK; mark[i] = t;
        rho[i] = r; phi[i] = atan2(-dy, -dx); tilt[i] = 1;
        vx[i] = (vy[i] * ux - vx[i] * uy) / r;  // the angular speed it arrives with
        if (i < nPage) fed++;
      }
    }
    if (s === DISK) {
      // the orbit decays and tips over into the plane of the disk; the piece stretches into a streak and fades
      vx[i] += ((120 + 240 * grow) * (0.8 + 0.4 * dice[i]) / rho[i] - vx[i]) * (1 - exp(-dt * 2.5));
      const q = rho[i] -= (rho[i] * 0.7 + 20) * dt;
      phi[i] -= vx[i] * dt;
      tilt[i] += (FLAT - tilt[i]) * (1 - exp(-dt * 2.2));
      const cp = cos(phi[i]), sp = sin(phi[i]), life = sat((q - inner) / (R * 3 + 20));
      const tx = sp, ty = -cp * tilt[i], long = (0.6 + 2.6 * (1 - life)) / (hypot(tx, ty) || 1);
      px = hx + q * cp; py = hy + q * sp * tilt[i];
      sx = tx * long; sy = ty * long;
      heat = max(heat, 1 - 0.5 * life * life);
      alpha *= min(1, life * 2.2);
      scale *= 0.45 + 0.55 * life;
      rot[i] += spin[i] * dt * life;
      if (sp > 0) { layer = 2; inFront++; }
      if (q <= inner) { state[i] = GONE; alpha = 0; }
    } else if (!held) {
      px += vx[i] * dt; py += vy[i] * dt;
      rot[i] += spin[i] * dt;
    }
    x[i] = px; y[i] = py;
    live[o] = px; live[o + 1] = py; live[o + 2] = rot[i]; live[o + 3] = scale;
    live[o + 4] = sx; live[o + 5] = sy; live[o + 6] = heat + layer; live[o + 7] = alpha;
  }
  p.alive = alive; p.front = inFront;
  if (!alive && !done) done = t;
}

// ---- and back, as if nothing happened
// Every piece unwinds around the hole to where it came from: out along a spiral, a little too far, and back.
const still = { x: 0, y: 0, r: 0, feed: 0 };

function rewindFrom() {
  const p = P, { n, nPage, live, x, y, hx, hy, rot, rho, phi, tilt, state } = p;
  Object.assign(still, hole);
  for (let i = 0, o = 0; i < n; i++, o += 8) {
    const gone = state[i] === GONE;
    p.a[i] = gone ? 0.2 : live[o + 3];
    p.b[i] = gone ? 1 : live[o + 6] % 2;
    p.c[i] = gone ? 0 : live[o + 7];
    if (i >= nPage) continue;
    const dx = hx[i] - still.x, dy = hy[i] - still.y;
    let turn = gone ? 2.4 : atan2(dy, dx) - atan2(y[i] - still.y, x[i] - still.x);
    turn -= TAU * round(turn / TAU);
    if (turn < -1) turn += TAU;  // unwind the way it came, even if that is the long way
    rho[i] = gone ? 0 : hypot(x[i] - still.x, y[i] - still.y);
    phi[i] = turn; tilt[i] = hypot(dx, dy);
    rot[i] -= TAU * round(rot[i] / TAU);
  }
}

function rewind(tr, dt) {
  const p = P, { n, nPage, live, x, y, hx, hy, rot, rho, phi, tilt, seed } = p;
  const shut = ramp(0, 0.22, tr);
  hole.r = still.r * (1 - shut * shut);  // the hole collapses
  hole.feed = still.feed * (1 - shut);
  for (let i = 0, o = 0; i < n; i++, o += 8) {
    if (i >= nPage) { live[o + 7] = p.c[i] * sat(1 - tr / 0.1); continue; }  // shards and sparks just go out
    const u = sat((tr - seed[i] * 0.06) / 0.3), k = 1 - u;
    if (u >= 1) {  // home, exactly
      live[o] = x[i] = hx[i]; live[o + 1] = y[i] = hy[i];
      live[o + 2] = live[o + 4] = live[o + 5] = live[o + 6] = 0; live[o + 3] = live[o + 7] = 1;
      continue;
    }
    const e = 1 - 2.3 * k * k * k + 1.3 * k * k;  // ease out and overshoot: the rubber band
    const r = mix(rho[i], tilt[i], e), a = atan2(hy[i] - still.y, hx[i] - still.x) - phi[i] * k * k;
    const px = still.x + r * cos(a), py = still.y + r * sin(a);
    const mx = px - x[i], my = py - y[i], m = hypot(mx, my), long = dt > 0 ? min(2.2, m / dt / 1500) * k / (m || 1) : 0;
    x[i] = px; y[i] = py;
    live[o] = px; live[o + 1] = py; live[o + 2] = rot[i] * k * k; live[o + 3] = mix(p.a[i], 1, sat(u * 2));
    live[o + 4] = mx * long; live[o + 5] = my * long; live[o + 6] = p.b[i] * k * k; live[o + 7] = mix(p.c[i], 1, sat(u * 3));
  }
  p.alive = n; p.front = 0;
}

// ---- the frame loop and the phases
let raf = 0, tPrev = 0, tStart = 0, tRelease = 0, uHeld = 0, pace = 1, lag = 0, stage = null;

function run() { if (!raf) { tPrev = now(); raf = requestAnimationFrame(frame); } }

function frame(t) {
  raf = 0;
  const gap = max(0, t - tPrev) / 1000;
  tPrev = t;
  try { step(t, min(0.034, gap), gap); } catch (err) {  // never leave the page hidden: put it back and stand down
    noGL = true;
    bail(false);
    console.warn('fx.js stood down:', err);
  }
  if (phase !== 'idle') raf = requestAnimationFrame(frame);
}

function step(t, dt, gap) {
  if (phase === 'charge') {
    const u = (t - tStart) / CHARGE;
    if (gap > 0.004) pace = min(pace, gap);  // the display's own rhythm, learned while we are still cheap
    if (!stage.ready && !noGL) prepare();
    if (u >= 1 && stage.ready) {
      // The swap. In this one frame the real page goes dark and its double shows up, piece for piece.
      strain(1, t, dt, 1);
      fitCanvas(view.q);
      explode();
      bang.t = t;
      lag = 0;
      word.el.style.display = word.dim.style.display = 'none';
      canvas.style.display = 'block';
      setPhase('hole');
      simulate(0, 0);
      render(0, 1);
    } else if (u >= 1 && (noGL || u > 2.4)) fizzle();
    else strain(u, t, dt, 1);
  } else if (phase === 'deflate') {
    const k = (t - tRelease) / DEFLATE;
    if (k >= 1) stop(); else strain(uHeld, t, dt, (1 - k) * (1 - k));
  } else if (phase === 'hole') {
    // a machine that plainly cannot keep that rhythm gets fewer pixels, not fewer frames
    lag = max(0, lag + (gap > pace * 1.8 ? 1 : -0.25));
    if (lag > 24 && view.q > 0.5) { view.q *= 0.8; lag = 0; fitCanvas(view.q); }
    simulate((t - bang.t) / 1000, dt);
    render((t - bang.t) / 1000, 1);
  } else if (phase === 'restore') {
    const tr = max(0, t - tRelease) / 1000;
    if (tr * 1000 >= RESTORE) {  // the swap back: every piece is on its glyph's own pixels by now
      stop();
      if (stage.wtf) label('wtf', mouse.x, mouse.y, true);
    } else {
      fitCanvas(1);  // full resolution for the hand-over, whatever the hole was drawn at
      rewind(tr, dt);
      render((t - bang.t) / 1000, 1 - ramp(0.02, 0.3, tr));
    }
  }
}

// Setup rides along with the charge, a slice per frame: GL first, then the census, then the atlas.
function prepare() {
  if (!gl) { noGL = !initGL(); return; }
  if (gl.isContextLost() || (doc.fonts && doc.fonts.status === 'loading')) return;
  if (!stage.cap) { view.dpr = min(window.devicePixelRatio || 1, 2); stage.cap = census(view.dpr); }
  if (!stage.cap.step(now() + 5) || !G.ready()) return;
  const tex = atlas(stage.cap.sprites, G.limit);
  P = cast(stage.cap, tex, view.dpr);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tex);
  gl.bindBuffer(gl.ARRAY_BUFFER, G.fixed);
  gl.bufferData(gl.ARRAY_BUFFER, P.fixed, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, G.live);
  gl.bufferData(gl.ARRAY_BUFFER, P.live, gl.DYNAMIC_DRAW);
  fitCanvas(view.q);
  render(9, 0, true);  // one hidden 2x2 pixel frame, so nothing compiles in the frame of the bang
  stage.ready = true;
}

function charge() {
  if (!press || press.moved || phase !== 'idle') return;
  press.timer = 0;
  press.charged = true;
  stage = { cap: null, ready: false, wtf: false };
  tStart = now();
  pace = 1;
  summonWord();
  setPhase('charge');
  strain(0, tStart, 0, 1);
  run();
}

function deflate() {  // released too early: let the air out
  uHeld = (now() - tStart) / CHARGE;
  tRelease = now();
  setPhase('deflate');
}

function fizzle() {  // no WebGL, or the page never finished loading: all that effort for nothing
  deflate();
  if (press) press.over = true;
  label('pfff', mouse.x, mouse.y);
}

function release() {
  tRelease = now();
  stage.wtf = true;
  rewindFrom();
  setPhase('restore');
}

// Instantly back to a plain page. Safe to call from anywhere, any number of times.
function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
  if (word.el) word.el.style.display = word.dim.style.display = 'none';
  if (canvas) canvas.style.display = 'none';
  setPhase('idle');
  P = null;
  if (!press) wire(false);
}

// Some other way out than letting go: Escape, blur, a context menu, a resize...
function bail(gently) {
  if (press) { press.over = true; clearTimeout(press.timer); }
  if (gently && phase === 'hole') release();
  else if (gently && phase === 'charge') deflate();
  else if (phase !== 'idle' && !(gently && (phase === 'restore' || phase === 'deflate'))) stop();
}

// ---- input
let press = null;  // the primary button, from down to up
let quiet = 0;  // until when to swallow the click that follows a release
const mouse = { x: 0, y: 0 };
let finger = false;  // the pointer is a fingertip: aim above it
function aim(e) { mouse.x = e.clientX; mouse.y = e.clientY - (finger ? LIFT : 0); }

const wires = [  // these listeners exist only while a press or the gag is live
  [window, 'pointermove', onMove, true], [window, 'pointerup', onUp, true], [window, 'pointercancel', () => bail(true), true],
  [window, 'keydown', (e) => { if (e.key === 'Escape') bail(true); }, true],
  [window, 'contextmenu', (e) => { if (finger && press) e.preventDefault(); else bail(true); }, true],  // Android answers a long press with a menu
  [doc, 'touchmove', veto, { capture: true, passive: false }],  // no scrolling under the hole, where the browser still asks
  [window, 'blur', () => bail(false), false], [window, 'resize', () => bail(false), false],
  [doc, 'visibilitychange', () => { if (doc.visibilityState === 'hidden') bail(false); }, false],
  [doc, 'dragstart', veto, true], [doc, 'selectstart', veto, true],
];
let wired = false;
function wire(on) {
  if (on === wired) return;
  wired = on;
  for (const [target, type, fn, capture] of wires) target[on ? 'addEventListener' : 'removeEventListener'](type, fn, capture);
}
function veto(e) { if (phase !== 'idle') e.preventDefault(); }

function onDown(e) {
  if (!e.isPrimary) { if (press && finger) bail(true); return; }  // a second finger: they want to zoom, not to play
  if (e.button !== 0 || e.ctrlKey) return;  // ctrl-click is a right click on a Mac
  if (e.clientX >= html.clientWidth || e.clientY >= html.clientHeight) return;  // that is a scrollbar
  if (press) clearTimeout(press.timer);
  if (phase !== 'idle') stop();  // pressing during the restore: snap it shut, then charge as usual
  finger = e.pointerType === 'touch';
  aim(e);
  quiet = 0;
  press = { x: e.clientX, y: e.clientY, slop: finger ? SLOP_FINGER : SLOP, moved: false, charged: false, over: false, timer: 0 };
  wire(true);
  const holdable = e.pointerType !== 'pen' && !calm.matches && !(e.target.closest && e.target.closest(BUSY));
  if (holdable) press.timer = setTimeout(charge, HOLD);
}

function onMove(e) {
  if (!press || !e.isPrimary) return;
  aim(e);
  if (e.pointerType === 'mouse' && !(e.buttons & 1)) onUp(e, true);  // it was released somewhere we could not see
  else if (!press.charged && hypot(e.clientX - press.x, e.clientY - press.y) > press.slop) {
    press.moved = true;  // a drag: selecting text, or a finger scrolling. Not our business.
    clearTimeout(press.timer);
  }
}

function onUp(e, lost) {
  if (!press || !e.isPrimary || (lost !== true && e.button !== 0)) return;
  const p = press;
  press = null;
  clearTimeout(p.timer);
  aim(e);
  if (p.charged) quiet = now() + 400;  // whatever this press did, it was not a click on a link
  if (!p.over) {
    if (phase === 'hole') release();
    else if (phase === 'charge') { deflate(); label('click', mouse.x, mouse.y); }
    else if (!p.moved) label('click', mouse.x, mouse.y);
  }
  if (phase === 'idle') wire(false);
}

window.addEventListener('pointerdown', onDown, true);
window.addEventListener('dblclick', (e) => {
  if (e.button !== 0 || phase !== 'idle') return;
  if (newest) newest.remove();  // the burst replaces the second "click"
  burst(e.clientX, e.clientY);
}, true);
window.addEventListener('click', (e) => {
  if (now() < quiet) { quiet = 0; e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
})();
