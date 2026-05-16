/**
 * pageWriter.js
 *
 * Attaches a canvas-texture overlay to a PageGeo so the user can "write"
 * on the page in 3-D.  Everything lives inside Three.js — no DOM elements.
 *
 * Flow:
 *   1. Double-click a page  →  activateWriter(pageGeo, hitPoint, camera)
 *   2. User types           →  characters accumulate on the texture
 *   3. Enter / 5 s idle    →  typed text fades out over 1 s
 *   4.                         talkToDiary() is awaited
 *   5.                         Tom Riddle's reply fades-in letter-by-letter
 *   6. Any click outside   →  deactivateWriter()
 *
 * Public API
 * ──────────
 *   import { activateWriter, deactivateWriter, tickWriter, isWriterActive }
 *     from './pageWriter.js';
 *
 *   // call tickWriter(delta) in your render loop — it drives fade animations
 */

import * as THREE from 'three';
import { talkToDiary } from '/src/utils.js';

// ─── Texture canvas dimensions (power-of-two is friendliest for WebGL) ───────
const TEX_W = 512;
const TEX_H = 1024;

// ─── Visual constants ─────────────────────────────────────────────────────────
const FONT_SIZE = 60; // px on the texture canvas
const LINE_HEIGHT = FONT_SIZE * 1.5;
const MARGIN_X = 40;
const MARGIN_Y = 60;
const MAX_LINE_W = TEX_W - MARGIN_X * 2;
const INK_COLOR = '#1a0a00'; // very dark brown — looks like dried ink
const REPLY_COLOR = '#1a0a00';
const CURSOR_BLINK = 530; // ms
const IDLE_SUBMIT = 5000; // ms — auto-submit after this much inactivity
const FADE_DURATION = 1500; // ms

// ─── State ────────────────────────────────────────────────────────────────────
let _active = false;
let _pageGeo = null; // the PageGeo instance we are writing on
let _overlayMesh = null; // thin quad sitting above the page
let _ctx = null; // 2-D canvas context
let _tex = null; // THREE.CanvasTexture

let _typedText = ''; // raw user input
let _replyText = ''; // Riddle's response
let _replyVisible = 0; // how many chars of reply are currently shown
let _replyTimer = 0; // ms since last char reveal

let _phase = 'idle'; // idle | typing | fadingOut | dismissing | waiting | fadingIn | showing
let _fadeProgress = 0; // 0→1 for fade-out; 1→0 for fade-in
let _globalAlpha = 1;

let _cursorVisible = true;
let _lastCursorFlip = 0;
let _lastKeyTime = 0;
let _parent = null; // THREE.Object3D to add overlay into (bookGroup)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createOverlayCanvas() {
  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = TEX_H;
  return c;
}

/**
 * Wrap text into lines that fit within maxWidth on the given ctx.
 * Returns an array of strings.
 */
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Repaint the overlay canvas from scratch.
 * @param {number} alpha  0 (invisible) → 1 (fully opaque)
 */
function repaintCanvas(alpha) {
  if (!_ctx) return;

  _ctx.clearRect(0, 0, TEX_W, TEX_H);

  _ctx.font = `${FONT_SIZE}px 'La Belle Aurore', cursive`;
  _ctx.textBaseline = 'top';
  _ctx.globalAlpha = alpha;

  if (
    _phase === 'typing' ||
    _phase === 'fadingOut' ||
    _phase === 'dismissing'
  ) {
    // Draw user's typed text + blinking cursor
    _ctx.fillStyle = INK_COLOR;

    const display =
      _typedText + (_cursorVisible && _phase === 'typing' ? '|' : '');
    const lines = wrapText(_ctx, display || '|', MAX_LINE_W);

    lines.forEach((line, i) => {
      _ctx.fillText(line, MARGIN_X, MARGIN_Y + i * LINE_HEIGHT);
    });
  } else if (_phase === 'fadingIn' || _phase === 'showing') {
    // Draw as many reply characters as are revealed
    _ctx.fillStyle = REPLY_COLOR;

    const visible = _replyText.slice(0, _replyVisible);
    const lines = wrapText(_ctx, visible, MAX_LINE_W);

    lines.forEach((line, i) => {
      _ctx.fillText(line, MARGIN_X, MARGIN_Y + i * LINE_HEIGHT);
    });
  }

  _ctx.globalAlpha = 1;
  _tex.needsUpdate = true;
}

/**
 * Build the translucent quad that sits 2 mm above the page surface.
 * We size it to match the page's visual rectangle.
 */
function buildOverlayMesh(pageGeo) {
  const geom = pageGeo.geometry;
  // Read the page dimensions from its PlaneGeometry parameters
  const { width, height } = geom.parameters;

  // The page is translated so its left edge is at the spine.
  // PlaneGeometry is centred at origin before translate, so after
  //   .translate(width / 1.9, 0, z)
  // the mesh spans roughly [0 … width] in X and [-height/2 … height/2] in Y.
  // We create an overlay of the same size and position.
  const oGeo = new THREE.PlaneGeometry(width, height);
  oGeo.translate(width / 1.9, 0, 0);

  // Canvas texture
  const canvas = createOverlayCanvas();
  _ctx = canvas.getContext('2d');
  _tex = new THREE.CanvasTexture(canvas);
  _tex.minFilter = THREE.LinearFilter;

  const mat = new THREE.MeshBasicMaterial({
    map: _tex,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
  });

  const mesh = new THREE.Mesh(oGeo, mat);
  // Copy the page's world Z so the overlay sits exactly on it, plus a tiny epsilon
  const pageZ = geom.attributes.position.getZ(0); // any vertex — they share Z at rest
  mesh.position.z = pageZ + 0.005;

  return mesh;
}

// ─── Phase transitions ────────────────────────────────────────────────────────

async function submitText() {
  if (_phase !== 'typing') return;
  const question = _typedText.trim();
  if (!question) return;

  // Start fade-out
  _phase = 'fadingOut';
  _fadeProgress = 0;

  // After the fade completes (1 s), call the diary and fade reply in.
  // tickWriter drives _fadeProgress; once it hits 1 it calls onFadeOutDone.
  _pendingQuestion = question;
}

let _pendingQuestion = null;

function onFadeOutDone() {
  _phase = 'waiting';
  _typedText = '';
  _replyText = '';
  _replyVisible = 0;
  repaintCanvas(0);

  talkToDiary(_pendingQuestion).then((reply) => {
    _pendingQuestion = null;
    _replyText = reply;
    _replyVisible = 0;
    _replyTimer = 0;
    _phase = 'fadingIn';
    _fadeProgress = 0; // we re-use this as "seconds into fade-in"
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function isWriterActive() {
  return _active;
}

/**
 * Call from your dblclick handler.
 * @param {PageGeo}        pageGeo   the page that was double-clicked
 * @param {THREE.Scene}    scene
 */
export function activateWriter(pageGeo, parent) {
  // If already writing on this page, do nothing
  if (_active && _pageGeo === pageGeo) return;

  // Deactivate any previous session
  deactivateWriter();

  _active = true;
  _pageGeo = pageGeo;
  _parent = parent;
  _phase = 'typing';
  _typedText = '';
  _replyText = '';
  _replyVisible = 0;
  _fadeProgress = 0;
  _globalAlpha = 1;
  _lastKeyTime = performance.now();
  _lastCursorFlip = performance.now();
  _cursorVisible = true;

  _overlayMesh = buildOverlayMesh(pageGeo);
  _parent.add(_overlayMesh);

  repaintCanvas(1);
}

/**
 * Call when the user clicks elsewhere or presses Escape.
 */
export function deactivateWriter() {
  if (!_active) return;

  if (_overlayMesh && _parent) {
    _parent.remove(_overlayMesh);
    _overlayMesh.geometry.dispose();
    _overlayMesh.material.map.dispose();
    _overlayMesh.material.dispose();
    _overlayMesh = null;
  }

  _tex = null;
  _ctx = null;
  _active = false;
  _pageGeo = null;
  _phase = 'idle';
}

/**
 * Feed a raw KeyboardEvent to the writer.
 * Call from your keydown handler ONLY when the writer is active.
 */
export function writerHandleKey(event) {
  if (!_active || _phase !== 'typing') return;

  const { key } = event;
  _lastKeyTime = performance.now();

  if (key === 'Enter') {
    submitText();
    return;
  }

  if (key === 'Backspace') {
    _typedText = _typedText.slice(0, -1);
  } else if (key === 'Escape') {
    deactivateWriter();
    return;
  } else if (key.length === 1) {
    _typedText += key;
  }

  repaintCanvas(1);
}

/**
 * Call every frame from your render loop.
 * @param {number} deltaMs  milliseconds since last frame
 */
export function tickWriter(deltaMs) {
  if (!_active) return;

  const now = performance.now();

  // ── Cursor blink ────────────────────────────────────────────────────────────
  if (_phase === 'typing') {
    if (now - _lastCursorFlip > CURSOR_BLINK) {
      _cursorVisible = !_cursorVisible;
      _lastCursorFlip = now;
      repaintCanvas(1);
    }

    // Auto-submit after idle
    if (_typedText && now - _lastKeyTime > IDLE_SUBMIT) {
      submitText();
    }
    return;
  }

  // ── Fade out user text ──────────────────────────────────────────────────────
  if (_phase === 'fadingOut') {
    _fadeProgress += deltaMs / FADE_DURATION;
    if (_fadeProgress >= 1) {
      _fadeProgress = 1;
      repaintCanvas(0);
      onFadeOutDone();
    } else {
      repaintCanvas(1 - _fadeProgress);
    }
    return;
  }

  // ── Waiting for API ─────────────────────────────────────────────────────────
  if (_phase === 'waiting') {
    // Nothing to draw — canvas is blank; optionally show a subtle ellipsis
    return;
  }

  // ── Fade in reply letter-by-letter ─────────────────────────────────────────
  if (_phase === 'fadingIn') {
    // Reveal one character every ~60 ms for a handwriting feel
    _replyTimer += deltaMs;
    const CHAR_INTERVAL = 60; // ms per character
    while (_replyTimer >= CHAR_INTERVAL && _replyVisible < _replyText.length) {
      _replyVisible++;
      _replyTimer -= CHAR_INTERVAL;
    }

    if (_replyVisible >= _replyText.length) {
      _phase = 'showing';
    }

    repaintCanvas(1);
    return;
  }

  // ── Fully shown ─────────────────────────────────────────────────────────────
  // 'showing' — nothing to animate; user can double-click again to start over.
}
