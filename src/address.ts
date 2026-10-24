export function isLocalAddress(address: string): boolean {
  const host = new URL(address).hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host === '::1' || host === '::' || /^(?:fc|fd)[\da-f]{2}:|^fe[89ab][\da-f]:/.test(host)) return true;
  const mapped = host.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/);
  const octets = mapped ? [parseInt(mapped[1]!, 16) >> 8, parseInt(mapped[1]!, 16) & 255]
    : /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host.split('.').map(Number) : undefined;
  if (octets) {
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || (a === 172 && b! >= 16 && b! <= 31)
      || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b! >= 64 && b! <= 127);
  }
  return !host.includes('.') && !host.includes(':');
}
