import type { CommandBatch, MaterialPreset, ShapeKind, SimulationCommand, SpawnBodyCommand } from '../types/commands';

const COLOR_WORDS: Record<string, string> = {
  red: '#e74c3c',
  blue: '#3498db',
  green: '#2ecc71',
  yellow: '#f39c12',
  purple: '#9b59b6',
  orange: '#e67e22',
  pink: '#fd79a8',
  white: '#ecf0f1',
  black: '#2d3436',
  gray: '#95a5a6',
  grey: '#95a5a6',
  brown: '#8B4513',
  teal: '#1abc9c',
  wooden: '#8B4513',
  wood: '#8B4513',
  iron: '#666677',
};

function mapShape(word: string): ShapeKind {
  const w = word.toLowerCase();
  if (/sphere|ball|circle|orb|globe/.test(w)) return 'sphere';
  if (/capsule|pill/.test(w)) return 'capsule';
  if (/cylinder|wheel|tube|pipe/.test(w)) return 'cylinder';
  return 'box';
}

function extractColor(text: string): string | undefined {
  for (const [word, hex] of Object.entries(COLOR_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text)) return hex;
  }
  return undefined;
}

function applyMaterial(cmd: SpawnBodyCommand): SpawnBodyCommand {
  if (!cmd.material || cmd.material === 'default') return cmd;
  const presets: Record<MaterialPreset, Partial<SpawnBodyCommand>> = {
    wood: { density: 0.55, friction: 0.55, color: '#8B4513', restitution: 0.15 },
    iron: { density: 7.5, friction: 0.45, color: '#5a5a6a', restitution: 0.1 },
    rubber: { density: 1.1, friction: 0.8, restitution: 0.92, color: '#2ecc71' },
    default: {},
  };
  const p = presets[cmd.material];
  return {
    ...cmd,
    density: cmd.density ?? p.density,
    friction: cmd.friction ?? p.friction,
    restitution: cmd.restitution ?? p.restitution,
    color: cmd.color ?? p.color,
  };
}

function normalizeSpawn(cmd: SpawnBodyCommand, promptHint?: string): SpawnBodyCommand {
  let shape = cmd.shape;
  if (typeof shape === 'string') {
    shape = mapShape(shape);
  }

  let size = cmd.size;
  if (shape === 'box' && !size && /rect|rectangle|domino/i.test(promptHint ?? '')) {
    size = { x: 0.3, y: 1.2, z: 0.8 };
  }

  const color = cmd.color ?? (promptHint ? extractColor(promptHint) : undefined);

  return applyMaterial({
    ...cmd,
    shape,
    size,
    color,
  });
}

function normalizeCommand(cmd: SimulationCommand, promptHint?: string): SimulationCommand {
  if (cmd.action === 'spawn') {
    return normalizeSpawn(cmd, promptHint);
  }
  if (cmd.action === 'spawnPattern') {
    return {
      ...cmd,
      shape: cmd.shape ? mapShape(cmd.shape) : 'box',
      color: cmd.color ?? (promptHint ? extractColor(promptHint) : undefined),
    };
  }
  return cmd;
}

export function normalizeBatch(batch: CommandBatch, promptHint?: string): CommandBatch {
  return {
    ...batch,
    commands: batch.commands.map((c) => normalizeCommand(c, promptHint)),
  };
}
