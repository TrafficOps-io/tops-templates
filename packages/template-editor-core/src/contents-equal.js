const encoder = new TextEncoder();
const bytes = value => typeof value === 'string' ? encoder.encode(value) : value;

export function contentsEqual(left, right) {
  if (typeof left === 'string' && typeof right === 'string') return left === right;
  const leftBytes = bytes(left), rightBytes = bytes(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  for (let index = 0; index < leftBytes.byteLength; index++) if (leftBytes[index] !== rightBytes[index]) return false;
  return true;
}

