// Crosshair drawing, shared by the HUD and the preview in Options.
// Shapes: classic cross, T (no top line), dot only, circle. Length, thickness
// and gap are in crosshair units: the HUD scales them with the screen height.

export const CROSSHAIR_SHAPES = ['cross', 't', 'dot', 'circle'];

export const CROSSHAIR_DEFAULTS = {
  shape: 'cross',
  color: '#32fa32',
  alpha: 1,        // opacity, 0.1 - 1
  length: 9,       // 1 - 20
  thickness: 1,    // 1 - 6
  gap: 4,          // 0 - 20; 4 is the 1.6 gap of the rifles
  dynamic: true,   // opens up when moving, jumping and shooting, like 1.6
  dot: false,
  outline: false,
};

// quick picks in Options (the 1.6 cl_crosshair_color presets first)
export const CROSSHAIR_SWATCHES = ['#32fa32', '#fa3232', '#3232fa', '#fafa32', '#32fafa', '#ffffff', '#fa32fa', '#000000'];

// how big the crosshair is on screen: 1.6 draws it bigger at higher resolutions
export const crosshairScale = (screenHeight) => Math.max(1, screenHeight / 600);

// The gap to draw (in units) for the 1.6 dynamic gap `dyn` of the current
// weapon and stance. 1.6 rifles stand at 4: the gap setting replaces that, and
// pistols, moving, jumping and shooting open it up from there.
export const crosshairGap = (o, dyn) => Math.max(0, o.dynamic ? o.gap + dyn - 4 : o.gap);

// How far the crosshair reaches from the centre, in pixels (to size a canvas)
export function crosshairExtent(o, gapUnits, scale) {
  const th = Math.max(1, Math.round(o.thickness * scale));
  return Math.ceil(gapUnits * scale + o.length * scale + th + 3);
}

// Draws the crosshair around the pixel corner (cx, cy), the centre of the
// screen. Everything is drawn opaque: fade it with the canvas opacity, so the
// outline doesn't show through the lines.
export function drawCrosshair(ctx, cx, cy, o, gapUnits, scale) {
  const th = Math.max(1, Math.round(o.thickness * scale));
  const len = Math.max(1, Math.round(o.length * scale));
  const gap = Math.max(0, Math.round(gapUnits * scale));
  const ow = Math.max(1, Math.round(scale * 0.75)); // outline width
  // the centre block the lines line up with (the pixel right/below the centre for 1 px lines)
  const c0x = cx - (th >> 1), c0y = cy - (th >> 1);
  const rects = [];
  if (o.shape === 'cross' || o.shape === 't') {
    if (o.shape === 'cross') rects.push([c0x, c0y - gap - len, th, len]);
    rects.push([c0x, c0y + th + gap, th, len]);
    rects.push([c0x - gap - len, c0y, len, th]);
    rects.push([c0x + th + gap, c0y, len, th]);
  }
  if (o.dot || o.shape === 'dot') {
    // "dot only" grows with the thickness setting; the dot inside thin lines
    // is two pixels bigger so it shows (same odd/even size, so it stays centred)
    const ds = o.shape === 'dot' ? Math.max(3, Math.round((o.thickness + 2) * scale)) : th < 3 ? th + 2 : th;
    rects.push([cx - (ds >> 1), cy - (ds >> 1), ds, ds]);
  }
  let ring = 0;
  if (o.shape === 'circle') ring = Math.max(2, gap + len / 2);
  const ringStroke = (w) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(cx + ((th & 1) ? 0.5 : 0), cy + ((th & 1) ? 0.5 : 0), ring, 0, Math.PI * 2);
    ctx.stroke();
  };
  if (o.outline) {
    ctx.fillStyle = ctx.strokeStyle = '#000';
    for (const [x, y, w, h] of rects) ctx.fillRect(x - ow, y - ow, w + ow * 2, h + ow * 2);
    if (ring) ringStroke(th + ow * 2);
  }
  ctx.fillStyle = ctx.strokeStyle = o.color;
  for (const [x, y, w, h] of rects) ctx.fillRect(x, y, w, h);
  if (ring) ringStroke(th);
}

// Keeps a crosshair canvas centred on the screen and redraws it when needed.
// The canvas is sized in device pixels so 1 px lines stay sharp.
export class CrosshairCanvas {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.key = '';
    this.size = 0;
  }

  // o: crosshair settings, gapUnits from crosshairGap(), scale in CSS pixels
  draw(o, gapUnits, scale) {
    const dpr = window.devicePixelRatio || 1;
    const s = scale * dpr;
    const key = `${o.shape}|${o.color}|${o.length}|${o.thickness}|${o.dot}|${o.outline}|${gapUnits.toFixed(2)}|${s.toFixed(3)}`;
    if (key === this.key) return;
    this.key = key;
    // an even number of device pixels, so the centre is a pixel corner
    const need = (crosshairExtent(o, gapUnits, s) + 2) * 2;
    if (need > this.size || need < this.size / 2) {
      this.size = Math.ceil(need / 16) * 16;
      this.canvas.width = this.canvas.height = this.size;
      const css = this.size / dpr;
      this.canvas.style.width = this.canvas.style.height = css + 'px';
      this.canvas.style.marginLeft = this.canvas.style.marginTop = -css / 2 + 'px';
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.size, this.size);
    const c = this.size / 2;
    drawCrosshair(ctx, c, c, o, gapUnits, s);
  }
}
