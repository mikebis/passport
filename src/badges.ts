import { isCompletedStatus, type Territory, type TravelStatus } from './types';

export type BadgeCondition =
  | { kind: 'country'; id: string }
  | { kind: 'and' | 'or'; children: BadgeCondition[] }
  | { kind: 'threshold'; ids: string[]; target: number };

export interface Badge {
  name: string;
  description: string;
  condition: BadgeCondition;
  value: number;
}

export interface BadgeProgress {
  completed: number;
  total: number;
  earned: boolean;
}

export function badgeCountryIds(condition: BadgeCondition): string[] {
  const ids = new Set<string>();
  function visit(node: BadgeCondition): void {
    if (node.kind === 'country') ids.add(node.id);
    else if (node.kind === 'threshold') node.ids.forEach((id) => ids.add(id));
    else node.children.forEach(visit);
  }
  visit(condition);
  return [...ids];
}

export function parseCondition(source: string, registry: readonly Territory[]): BadgeCondition {
  if (!source.trim() || source.length > 4096) throw new Error('Condition must contain 1-4096 characters.');
  const ids = new Set(registry.map((country) => country.id));
  const tokens: { text: string; position: number }[] = [];
  let offset = 0;
  function fail(message: string, position = tokens[index]?.position ?? source.length): never {
    throw new Error(`${message} at position ${position + 1}.`);
  }
  let index = 0;
  while (offset < source.length) {
    if (/\s/.test(source[offset]!)) { offset++; continue; }
    const match = /^(?:[A-Za-z][A-Za-z0-9_:]*|\d+|[()+|,{}])/.exec(source.slice(offset));
    if (!match) fail('Unexpected character', offset);
    tokens.push({ text: match[0], position: offset });
    offset += match[0].length;
  }
  const take = (text: string): boolean => {
    if (tokens[index]?.text !== text) return false;
    index++;
    return true;
  };
  const require = (text: string): void => { if (!take(text)) fail(`Expected "${text}"`); };
  function country(): string {
    const token = tokens[index];
    if (!token || !ids.has(token.text)) fail(`Expected a canonical territory ID, received "${token?.text ?? 'end of condition'}"`);
    index++;
    return token.text;
  }
  function primary(depth: number): BadgeCondition {
    if (!take('(')) return { kind: 'country', id: country() };
    if (depth >= 32) fail('Condition exceeds 32 nesting levels');
    const first = expression(depth + 1);
    if (tokens[index]?.text === ',' || (tokens[index]?.text === ')' && tokens[index + 1]?.text === '{')) {
      if (first.kind !== 'country') fail('Thresholds require a comma-separated list of territory IDs');
      const members = [first.id];
      while (take(',')) members.push(country());
      require(')');
      require('{');
      const target = Number(tokens[index]?.text);
      if (!/^\d+$/.test(tokens[index]?.text ?? '') || !Number.isSafeInteger(target) || target < 1) {
        fail('Threshold must be a positive integer');
      }
      index++;
      require('}');
      if (new Set(members).size !== members.length) fail('Threshold contains duplicate territory IDs');
      if (target > members.length) fail('Threshold exceeds the number of distinct territories');
      return { kind: 'threshold', ids: members, target };
    }
    require(')');
    return first;
  }
  function conjunction(depth: number): BadgeCondition {
    const children = [primary(depth)];
    while (take('+')) children.push(primary(depth));
    return children.length === 1 ? children[0]! : { kind: 'and', children };
  }
  function expression(depth: number): BadgeCondition {
    const children = [conjunction(depth)];
    while (take('|')) children.push(conjunction(depth));
    return children.length === 1 ? children[0]! : { kind: 'or', children };
  }
  const result = expression(0);
  if (index !== tokens.length) fail('Unexpected token');
  return result;
}

export function parseBadges(value: unknown, registry: readonly Territory[]): Badge[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error('Badge catalog must be an array of at most 500 definitions.');
  const names = new Set<string>();
  let points = 0;
  return value.map((entry: unknown, index): Badge => {
    const prefix = `Badge ${index + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${prefix}: expected an object.`);
    const fields: Record<string, unknown> = entry as Record<string, unknown>;
    if (Object.keys(fields).length !== 4 || !['name', 'description', 'condition', 'value'].every((key) => Object.hasOwn(fields, key))) {
      throw new Error(`${prefix}: expected exactly name, description, condition and value.`);
    }
    function text(key: string, limit: number): string {
      const field = fields[key];
      if (typeof field !== 'string' || !field.trim() || field.length > limit) {
        throw new Error(`${prefix}: ${key} must contain 1-${limit} characters.`);
      }
      return field.trim();
    }
    const name = text('name', 120);
    const description = text('description', 1000);
    const condition = text('condition', 4096);
    const key = name.toLocaleLowerCase('en');
    if (names.has(key)) throw new Error(`${prefix}: duplicate badge name "${name}".`);
    names.add(key);
    if (typeof fields.value !== 'number' || !Number.isSafeInteger(fields.value) || fields.value < 0) {
      throw new Error(`${prefix} "${name}": value must be non-negative safe-integer points.`);
    }
    points += fields.value;
    if (!Number.isSafeInteger(points)) throw new Error('Total badge points exceed the safe-integer limit.');
    try {
      return { name, description, condition: parseCondition(condition, registry), value: fields.value };
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      throw new Error(`${prefix} "${name}": ${error.message}`);
    }
  });
}

export function evaluateBadge(condition: BadgeCondition, status: (id: string) => TravelStatus): BadgeProgress {
  if (condition.kind === 'country') {
    const earned = isCompletedStatus(status(condition.id));
    return { completed: Number(earned), total: 1, earned };
  }
  if (condition.kind === 'threshold') {
    const completed = Math.min(condition.target, condition.ids.filter((id) => isCompletedStatus(status(id))).length);
    return { completed, total: condition.target, earned: completed === condition.target };
  }
  const children = condition.children.map((child) => evaluateBadge(child, status));
  if (condition.kind === 'or') {
    return { completed: Math.max(...children.map((child) => child.completed / child.total)), total: 1, earned: children.some((child) => child.earned) };
  }
  return {
    completed: children.reduce((sum, child) => sum + child.completed, 0),
    total: children.reduce((sum, child) => sum + child.total, 0),
    earned: children.every((child) => child.earned),
  };
}
