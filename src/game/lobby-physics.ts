export type Body = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
};
export type Bounds = {
  width: number;
  height: number;
  tagWidth: number;
  tagHeight: number;
};
export function clampBody(b: Body, bounds: Bounds) {
  b.x = Math.max(0, Math.min(b.x, Math.max(0, bounds.width - bounds.tagWidth)));
  b.y = Math.max(
    0,
    Math.min(b.y, Math.max(0, bounds.height - bounds.tagHeight)),
  );
  return b;
}
export function initialBody(
  index: number,
  count: number,
  bounds: Bounds,
): Body {
  const columns = Math.max(1, Math.min(count, Math.floor(bounds.width / 170)));
  const rows = Math.ceil(count / columns),
    cellWidth = bounds.width / columns,
    cellHeight = bounds.height / Math.max(1, rows);
  return clampBody(
    {
      x: (index % columns) * cellWidth + (cellWidth - bounds.tagWidth) / 2,
      y:
        Math.floor(index / columns) * cellHeight +
        (cellHeight - bounds.tagHeight) / 2,
      vx: 0,
      vy: 0,
      rotation: index % 2 ? 5 : -5,
    },
    bounds,
  );
}
export function stepBody(b: Body, bounds: Bounds, seconds: number) {
  const dt = Math.min(0.032, Math.max(0, seconds)),
    friction = Math.exp(-4.8 * dt);
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.vx *= friction;
  b.vy *= friction;
  if (b.x < 0 || b.x > Math.max(0, bounds.width - bounds.tagWidth))
    b.vx *= -0.45;
  if (b.y < 0 || b.y > Math.max(0, bounds.height - bounds.tagHeight))
    b.vy *= -0.45;
  clampBody(b, bounds);
  b.rotation +=
    (Math.max(-9, Math.min(9, b.vx * 0.018)) - b.rotation) *
    Math.min(1, dt * 4);
  if (Math.hypot(b.vx, b.vy) < 8) {
    b.vx = 0;
    b.vy = 0;
  }
  return b;
}
