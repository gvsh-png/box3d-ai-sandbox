import type { ReplayData, ReplayFrame } from '../physics/ReplayRecorder';

export function interpolateReplayAt(data: ReplayData, time: number): ReplayFrame {
  const frames = data.frames;
  if (frames.length === 0) {
    throw new Error('No replay frames to export');
  }
  if (time <= frames[0].t) return frames[0];
  if (time >= frames[frames.length - 1].t) return frames[frames.length - 1];

  let i = 0;
  while (i < frames.length - 2 && frames[i + 1].t <= time) i++;
  const a = frames[i];
  const b = frames[i + 1];
  const span = Math.max(0.0001, b.t - a.t);
  const alpha = Math.min(1, (time - a.t) / span);
  return interpolateFrames(a, b, alpha);
}

export function interpolateFrames(a: ReplayFrame, b: ReplayFrame, alpha: number): ReplayFrame {
  const bodies: ReplayFrame['bodies'] = {};
  for (const id of new Set([...Object.keys(a.bodies), ...Object.keys(b.bodies)])) {
    const sa = a.bodies[id];
    const sb = b.bodies[id];
    if (!sa || !sb) {
      bodies[id] = sa ?? sb!;
      continue;
    }
    bodies[id] = {
      p: sa.p.map((v, i) => v + (sb.p[i] - v) * alpha) as [number, number, number],
      q: sa.q.map((v, i) => v + (sb.q[i] - v) * alpha) as [number, number, number, number],
    };
  }
  return {
    t: a.t + (b.t - a.t) * alpha,
    bodies,
    camera: {
      p: a.camera.p.map((v, i) => v + (b.camera.p[i] - v) * alpha) as [number, number, number],
      target: a.camera.target.map((v, i) => v + (b.camera.target[i] - v) * alpha) as [
        number,
        number,
        number,
      ],
    },
  };
}
