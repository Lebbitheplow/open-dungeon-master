"use client";

import { useEffect, useRef } from "react";

// Living topographic backdrop: faint gold contour lines traced from a 3D
// value-noise field whose time axis creeps forward, so the terrain slowly
// breathes behind the app. Self-contained (no deps), throttled to ~20fps,
// paused in hidden tabs, and static under prefers-reduced-motion.

const CELL = 26; // css px between field samples
const LEVELS = [0.34, 0.42, 0.5, 0.58, 0.66, 0.74];
const INDEX_EVERY = 3; // every Nth level draws brighter, like map index contours
const SPEED = 0.05; // morph rate: terrain visibly reshapes over ~20s of watching
const DRIFT_X = 1.4; // css px per second the whole field crawls, for legible motion
const DRIFT_Y = 0.5;
const FRAME_MS = 50; // redraw cadence (~20fps)
const RENDER_SCALE = 0.75; // internal resolution; CSS stretch softens the lines

function hash3(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const fz = smooth(z - iz);

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c000 = hash3(ix, iy, iz);
  const c100 = hash3(ix + 1, iy, iz);
  const c010 = hash3(ix, iy + 1, iz);
  const c110 = hash3(ix + 1, iy + 1, iz);
  const c001 = hash3(ix, iy, iz + 1);
  const c101 = hash3(ix + 1, iy, iz + 1);
  const c011 = hash3(ix, iy + 1, iz + 1);
  const c111 = hash3(ix + 1, iy + 1, iz + 1);

  return lerp(
    lerp(lerp(c000, c100, fx), lerp(c010, c110, fx), fy),
    lerp(lerp(c001, c101, fx), lerp(c011, c111, fx), fy),
    fz,
  );
}

function fbm(x: number, y: number, z: number): number {
  return valueNoise3(x, y, z) * 0.65 + valueNoise3(x * 2.1, y * 2.1, z * 1.7) * 0.35;
}

export default function TopoBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let lastDraw = 0;
    let cols = 0;
    let rows = 0;
    let field = new Float32Array(0);
    const started = performance.now();

    function resize() {
      if (!canvas) {
        return;
      }
      canvas.width = Math.ceil(window.innerWidth * RENDER_SCALE);
      canvas.height = Math.ceil(window.innerHeight * RENDER_SCALE);
      cols = Math.ceil(window.innerWidth / CELL) + 2;
      rows = Math.ceil(window.innerHeight / CELL) + 2;
      field = new Float32Array(cols * rows);
    }

    function draw(nowMs: number) {
      if (!canvas || !ctx) {
        return;
      }
      const elapsed = (nowMs - started) / 1000;
      const t = elapsed * SPEED;
      const freq = 1 / (CELL * 5.2); // field feature size in css px

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          field[row * cols + col] = fbm(
            (col * CELL + elapsed * DRIFT_X) * freq,
            (row * CELL + elapsed * DRIFT_Y) * freq,
            t,
          );
        }
      }

      ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
      ctx.clearRect(0, 0, canvas.width / RENDER_SCALE, canvas.height / RENDER_SCALE);
      ctx.lineWidth = 1;

      LEVELS.forEach((iso, levelIndex) => {
        const isIndexLine = levelIndex % INDEX_EVERY === 1;
        ctx.strokeStyle = isIndexLine
          ? "rgba(212, 171, 58, 0.075)"
          : "rgba(212, 171, 58, 0.04)";
        ctx.beginPath();

        for (let row = 0; row < rows - 1; row += 1) {
          for (let col = 0; col < cols - 1; col += 1) {
            const tl = field[row * cols + col];
            const tr = field[row * cols + col + 1];
            const br = field[(row + 1) * cols + col + 1];
            const bl = field[(row + 1) * cols + col];
            const caseIndex =
              (tl > iso ? 8 : 0) | (tr > iso ? 4 : 0) | (br > iso ? 2 : 0) | (bl > iso ? 1 : 0);
            if (caseIndex === 0 || caseIndex === 15) {
              continue;
            }

            const x = col * CELL;
            const y = row * CELL;
            // Interpolated crossing points on the four cell edges.
            const top = { x: x + (CELL * (iso - tl)) / (tr - tl), y };
            const bottom = { x: x + (CELL * (iso - bl)) / (br - bl), y: y + CELL };
            const left = { x, y: y + (CELL * (iso - tl)) / (bl - tl) };
            const right = { x: x + CELL, y: y + (CELL * (iso - tr)) / (br - tr) };

            const segments: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];
            switch (caseIndex) {
              case 1: case 14: segments.push([left, bottom]); break;
              case 2: case 13: segments.push([bottom, right]); break;
              case 3: case 12: segments.push([left, right]); break;
              case 4: case 11: segments.push([top, right]); break;
              case 5: segments.push([left, top], [bottom, right]); break;
              case 6: case 9: segments.push([top, bottom]); break;
              case 7: case 8: segments.push([left, top]); break;
              case 10: segments.push([top, right], [left, bottom]); break;
            }
            for (const [a, b] of segments) {
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
            }
          }
        }
        ctx.stroke();
      });
    }

    function tick(nowMs: number) {
      raf = window.requestAnimationFrame(tick);
      if (nowMs - lastDraw < FRAME_MS) {
        return;
      }
      lastDraw = nowMs;
      draw(nowMs);
    }

    function onVisibility() {
      if (document.hidden) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      } else if (!raf && !reducedMotion) {
        raf = window.requestAnimationFrame(tick);
      }
    }

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resize();
        draw(performance.now());
      }, 150);
    }

    resize();
    if (reducedMotion) {
      draw(started);
    } else {
      raf = window.requestAnimationFrame(tick);
      document.addEventListener("visibilitychange", onVisibility);
    }
    window.addEventListener("resize", onResize);

    return () => {
      window.cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}
