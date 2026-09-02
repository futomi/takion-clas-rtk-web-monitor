'use client';

import { useCallback, useEffect, useRef } from 'react';
import { PLOT_TRAIL_MS } from '../lib/constants';
import type { QualityTone } from '../lib/correctionSource';
import {
  clampToBounds,
  formatGridLabel,
  formatPlaneLength,
  gridSpacingFor,
  toPlanePosition,
  trailOpacity,
  type PlanePosition,
  type PlotOrigin,
} from '../lib/localPlane';
import { trackPointTone, type TrackPoint } from '../lib/track';

type LocalPlotCanvasProps = {
  samples: TrackPoint[];
  origin: PlotOrigin | null;
  /** 表示半幅（m）。原点からこの距離までが短辺に収まる */
  rangeMeters: number;
  /** 右端に高さのゲージを出すか */
  showGauge: boolean;
};

/**
 * 測位品質ごとの色。
 * Canvas は CSS 変数を読めないため、map.css のマーカー色と同じ値をここにも書いている
 * （MapPanel の TRACK_LINE_COLOR と同じ出どころ）。
 */
const TONE_COLOR: Record<QualityTone, string> = {
  fix: '#219e70',
  float: '#ca5010',
  single: '#3aae81',
  none: '#9e9e9e',
};
const TONE_HALO: Record<QualityTone, string> = {
  fix: 'rgba(33, 158, 112, .22)',
  float: 'rgba(202, 80, 16, .22)',
  single: 'rgba(58, 174, 129, .22)',
  none: 'rgba(158, 158, 158, .22)',
};

const BACKGROUND = '#ffffff';
const GAUGE_BACKGROUND = '#fafafa';
const GRID_MINOR = '#ececec';
const GRID_MAJOR = '#d1d1d1';
const AXIS = '#9e9e9e';
const LABEL = '#616161';
const VALUE = '#242424';
const ORIGIN = '#0f6a4c';
const ACCURACY_FILL = 'rgba(15, 106, 76, .12)';
const ACCURACY_STROKE = 'rgba(15, 106, 76, .55)';

const FONT_LABEL = '600 12px ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';
const FONT_COMPASS = '600 14px system-ui, "Segoe UI", "Yu Gothic UI", sans-serif';

/** 平面の縁に空ける余白（px）。目盛りラベルと方位の文字を置く */
const PLANE_MARGIN = 30;
/** 高さゲージの幅（px） */
const GAUGE_WIDTH = 88;
/** これより狭い画面ではゲージを畳み、平面に全幅を使う */
const GAUGE_MIN_WIDTH = 440;
/** 範囲の外にある点を縁へ寄せるときに、縁からこの割合だけ内側に置く */
const EDGE_INSET_RATIO = 0.93;

/** 1 回の描画で共有する座標系 */
type Frame = {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  pxPerMeter: number;
  /** 平面の縁までの距離（m）。縦横で異なる */
  eastLimit: number;
  northLimit: number;
};

const toX = (frame: Frame, east: number) => frame.centerX + east * frame.pxPerMeter;
const toY = (frame: Frame, north: number) => frame.centerY - north * frame.pxPerMeter;
/** 1px の線をにじませずに引くための半ピクセル寄せ */
const crisp = (value: number) => Math.round(value) + 0.5;

function drawGrid(ctx: CanvasRenderingContext2D, frame: Frame, rangeMeters: number): void {
  const { width, height, centerX, centerY, eastLimit, northLimit } = frame;
  const { minor, major } = gridSpacingFor(rangeMeters);

  const drawLines = (spacing: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const eastCount = Math.ceil(eastLimit / spacing);
    for (let step = -eastCount; step <= eastCount; step += 1) {
      if (step === 0) continue;
      const x = crisp(toX(frame, step * spacing));
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    const northCount = Math.ceil(northLimit / spacing);
    for (let step = -northCount; step <= northCount; step += 1) {
      if (step === 0) continue;
      const y = crisp(toY(frame, step * spacing));
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  };
  drawLines(minor, GRID_MINOR);
  drawLines(major, GRID_MAJOR);

  ctx.strokeStyle = AXIS;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(crisp(centerX), 0);
  ctx.lineTo(crisp(centerX), height);
  ctx.moveTo(0, crisp(centerY));
  ctx.lineTo(width, crisp(centerY));
  ctx.stroke();

  // 目盛りは太い線にだけ付ける。縁に近いものは方位の文字と重なるので出さない
  ctx.fillStyle = LABEL;
  ctx.font = FONT_LABEL;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const eastCount = Math.ceil(eastLimit / major);
  for (let step = -eastCount; step <= eastCount; step += 1) {
    if (step === 0) continue;
    const x = toX(frame, step * major);
    if (x < 28 || x > width - 28) continue;
    ctx.fillText(formatGridLabel(step * major), x, centerY + 5);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const northCount = Math.ceil(northLimit / major);
  for (let step = -northCount; step <= northCount; step += 1) {
    if (step === 0) continue;
    const y = toY(frame, step * major);
    if (y < 20 || y > height - 20) continue;
    ctx.fillText(formatGridLabel(step * major), centerX + 6, y);
  }

  ctx.font = FONT_COMPASS;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('北', centerX, 6);
  ctx.textBaseline = 'bottom';
  ctx.fillText('南', centerX, height - 6);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillText('東', width - 8, centerY);
  ctx.textAlign = 'left';
  ctx.fillText('西', 8, centerY);
}

function drawOrigin(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { centerX, centerY } = frame;
  ctx.strokeStyle = ORIGIN;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(centerX, centerY, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(centerX - 12, centerY);
  ctx.lineTo(centerX + 12, centerY);
  ctx.moveTo(centerX, centerY - 12);
  ctx.lineTo(centerX, centerY + 12);
  ctx.stroke();

  ctx.fillStyle = ORIGIN;
  ctx.font = FONT_LABEL;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('原点', centerX + 10, centerY - 8);
}

/**
 * 尾。古い点ほど薄くし、線の色は区間の始点の測位品質で決める。
 * 範囲の外へ出た部分は Canvas の外に描かれて自然に切れる。
 */
function drawTrail(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  samples: TrackPoint[],
  positions: PlanePosition[],
): void {
  if (samples.length < 2) return;
  const latestAt = samples[samples.length - 1].at;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  for (let index = 1; index < samples.length; index += 1) {
    const from = positions[index - 1];
    const to = positions[index];
    ctx.globalAlpha = trailOpacity(latestAt - samples[index].at, PLOT_TRAIL_MS);
    ctx.strokeStyle = TONE_COLOR[trackPointTone(samples[index - 1])];
    ctx.beginPath();
    ctx.moveTo(toX(frame, from.east), toY(frame, from.north));
    ctx.lineTo(toX(frame, to.east), toY(frame, to.north));
    ctx.stroke();
  }

  // 1 エポックごとの点。静止時の揺れの幅がそのまま点の散らばりとして見える
  for (let index = 0; index < samples.length - 1; index += 1) {
    ctx.globalAlpha = trailOpacity(latestAt - samples[index].at, PLOT_TRAIL_MS) * 0.9;
    ctx.fillStyle = TONE_COLOR[trackPointTone(samples[index])];
    ctx.beginPath();
    ctx.arc(toX(frame, positions[index].east), toY(frame, positions[index].north), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** 最新の点。範囲の外にあれば縁に矢印を出して方向と距離を示す */
function drawCurrent(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  sample: TrackPoint,
  position: PlanePosition,
): void {
  const tone = trackPointTone(sample);
  const clamped = clampToBounds(
    position.east,
    position.north,
    frame.eastLimit * EDGE_INSET_RATIO,
    frame.northLimit * EDGE_INSET_RATIO,
  );
  const x = toX(frame, clamped.east);
  const y = toY(frame, clamped.north);

  if (clamped.isOutside) {
    // 原点から点へ向かう向き。Canvas は y が下向きなので北を反転する
    const angle = Math.atan2(-position.north, position.east);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = TONE_COLOR[tone];
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-8, -10);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-8, 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = LABEL;
    ctx.font = FONT_LABEL;
    ctx.textAlign = position.east >= 0 ? 'right' : 'left';
    ctx.textBaseline = position.north >= 0 ? 'top' : 'bottom';
    ctx.fillText(
      `範囲外 ${formatPlaneLength(position.distance)}`,
      x + (position.east >= 0 ? -18 : 18),
      y + (position.north >= 0 ? 18 : -18),
    );
    return;
  }

  const error = sample.horizontalError;
  if (error !== undefined && error > 0) {
    ctx.fillStyle = ACCURACY_FILL;
    ctx.strokeStyle = ACCURACY_STROKE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, error * frame.pxPerMeter, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.fillStyle = TONE_HALO[tone];
  ctx.beginPath();
  ctx.arc(x, y, 15, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = TONE_COLOR[tone];
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** 高さのゲージ。平面と同じ縮尺で、原点からの標高差を縦の棒で示す */
function drawGauge(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  left: number,
  rangeMeters: number,
  up: number | undefined,
  tone: QualityTone,
): void {
  const { height, centerY, pxPerMeter, northLimit } = frame;
  const axisX = left + GAUGE_WIDTH * 0.4;
  const middleX = left + GAUGE_WIDTH / 2;

  ctx.fillStyle = GAUGE_BACKGROUND;
  ctx.fillRect(left, 0, GAUGE_WIDTH, height);
  ctx.strokeStyle = GRID_MAJOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(crisp(left), 0);
  ctx.lineTo(crisp(left), height);
  ctx.stroke();

  const { major } = gridSpacingFor(rangeMeters);
  ctx.font = FONT_LABEL;
  ctx.fillStyle = LABEL;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const count = Math.ceil(northLimit / major);
  for (let step = -count; step <= count; step += 1) {
    const y = centerY - step * major * pxPerMeter;
    if (y < 24 || y > height - 24) continue;
    ctx.strokeStyle = step === 0 ? AXIS : GRID_MAJOR;
    ctx.beginPath();
    ctx.moveTo(axisX - 6, crisp(y));
    ctx.lineTo(axisX + 6, crisp(y));
    ctx.stroke();
    if (step !== 0) ctx.fillText(formatGridLabel(step * major), axisX + 10, y);
  }

  ctx.strokeStyle = AXIS;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(crisp(axisX), 22);
  ctx.lineTo(crisp(axisX), height - 22);
  ctx.stroke();

  ctx.fillStyle = LABEL;
  ctx.font = FONT_COMPASS;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('高さ', middleX, 6);

  ctx.textBaseline = 'bottom';
  ctx.font = FONT_LABEL;
  if (up === undefined) {
    ctx.fillText('—', middleX, height - 6);
    return;
  }

  const limitPx = centerY - 26;
  const barEnd = Math.max(-limitPx, Math.min(limitPx, up * pxPerMeter));
  ctx.fillStyle = TONE_HALO[tone];
  ctx.fillRect(axisX - 9, Math.min(centerY, centerY - barEnd), 18, Math.abs(barEnd));
  ctx.fillStyle = TONE_COLOR[tone];
  ctx.fillRect(axisX - 9, centerY - barEnd - 2, 18, 4);

  ctx.fillStyle = VALUE;
  ctx.fillText(formatPlaneLength(up, { signed: true }), middleX, height - 6);
}

/** 1 フレームぶんをまるごと描く。CSS ピクセルの座標系で呼ぶ */
export function drawLocalPlot(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  { samples, origin, rangeMeters, showGauge }: LocalPlotCanvasProps,
): void {
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, width, height);

  const gaugeWidth = showGauge && width >= GAUGE_MIN_WIDTH ? GAUGE_WIDTH : 0;
  const planeWidth = width - gaugeWidth;
  const centerX = planeWidth / 2;
  const centerY = height / 2;
  const pxPerMeter = Math.max(1, (Math.min(planeWidth, height) / 2 - PLANE_MARGIN) / rangeMeters);
  const frame: Frame = {
    width: planeWidth,
    height,
    centerX,
    centerY,
    pxPerMeter,
    eastLimit: centerX / pxPerMeter,
    northLimit: centerY / pxPerMeter,
  };

  drawGrid(ctx, frame, rangeMeters);
  drawOrigin(ctx, frame);

  const latest = samples.length > 0 ? samples[samples.length - 1] : null;
  if (origin && latest) {
    const positions = samples.map((sample) => toPlanePosition(origin, sample));
    drawTrail(ctx, frame, samples, positions);
    drawCurrent(ctx, frame, latest, positions[positions.length - 1]);
  }

  if (gaugeWidth > 0) {
    const up = origin && latest ? toPlanePosition(origin, latest).up : undefined;
    drawGauge(ctx, frame, planeWidth, rangeMeters, up, latest ? trackPointTone(latest) : 'none');
  }
}

/**
 * 白紙の局所平面に受信機の動きを描く Canvas。
 *
 * 地図タイルは最大ズームでも 1px が 20 cm 余りで、数十 cm の移動が画面上では 1〜2px にしかならない。
 * ここでは原点まわり数 m だけを画面いっぱいに広げ、cm 単位の動きがそのまま見えるようにする。
 *
 * 描き直しは点が増えたとき（1 エポックごと）と大きさが変わったときだけ。
 */
export default function LocalPlotCanvas(props: LocalPlotCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // ResizeObserver のコールバックから最新の props を読むための控え
  const propsRef = useRef<LocalPlotCanvasProps>(props);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height } = canvas.getBoundingClientRect();
    if (width === 0 || height === 0) return;

    // 高解像度の画面でぼやけないよう、実ピクセル数は devicePixelRatio 倍にする
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawLocalPlot(ctx, width, height, propsRef.current);
  }, []);

  useEffect(() => {
    propsRef.current = props;
    render();
  }, [props, render]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => render());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [render]);

  return (
    <canvas
      ref={canvasRef}
      className="plot-canvas"
      role="img"
      aria-label="原点から見た受信機の位置を、東西・南北の平面に描いた拡大プロット"
    />
  );
}
