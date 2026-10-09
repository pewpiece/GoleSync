import { baseUrlFor, normalizeBaseUrl, parsePairing, validatePairing, wsUrlFor } from '../src/services/pairing';

const TOKEN = 'abcdEFGH1234_-xyzABCDEFGH1234_-xy';

describe('parsePairing', () => {
  it('parses the agent QR payload', () => {
    expect(parsePairing(`golesync://pair?host=192.168.1.20&port=8765&token=${TOKEN}`)).toEqual({
      host: '192.168.1.20',
      port: 8765,
      token: TOKEN,
    });
  });

  it('accepts hostnames and trims whitespace', () => {
    expect(parsePairing(`  golesync://pair?host=laptop.tail1234.ts.net&port=8765&token=${TOKEN}\n`)?.host).toBe('laptop.tail1234.ts.net');
  });

  it.each([
    ['not a url', 'hello'],
    ['wrong scheme', `https://pair?host=1.2.3.4&port=1&token=${TOKEN}`],
    ['no query', 'golesync://pair'],
    ['missing token', 'golesync://pair?host=1.2.3.4&port=8765'],
    ['short token', 'golesync://pair?host=1.2.3.4&port=8765&token=abc'],
    ['bad port', `golesync://pair?host=1.2.3.4&port=99999&token=${TOKEN}`],
    ['non numeric port', `golesync://pair?host=1.2.3.4&port=abc&token=${TOKEN}`],
    ['host with path', `golesync://pair?host=evil.com/x&port=80&token=${TOKEN}`],
    ['host with space', `golesync://pair?host=a%20b&port=80&token=${TOKEN}`],
    ['token with symbols', 'golesync://pair?host=1.2.3.4&port=80&token=' + '!'.repeat(30)],
    ['bad percent encoding', `golesync://pair?host=%E0%A4%A&port=80&token=${TOKEN}`],
  ])('rejects %s', (_name, input) => {
    expect(parsePairing(input)).toBeNull();
  });
});

describe('validatePairing', () => {
  it('works with string params from the router', () => {
    expect(validatePairing({ host: '10.0.0.5', port: '8765', token: TOKEN })).not.toBeNull();
    expect(validatePairing({ host: '10.0.0.5', port: undefined, token: TOKEN })).toBeNull();
  });
});

describe('normalizeBaseUrl', () => {
  it.each([
    ['192.168.1.20:8765', 'http://192.168.1.20:8765'],
    ['http://laptop.ts.net:8765/', 'http://laptop.ts.net:8765'],
    ['  HTTP://10.0.0.1:1  ', 'HTTP://10.0.0.1:1'],
    ['[fd7a::1]:8765', 'http://[fd7a::1]:8765'],
  ])('%s', (input, out) => {
    expect(normalizeBaseUrl(input)).toBe(out);
  });

  it.each(['', 'ftp://x', 'http://a b', 'http://x:99999', 'http://host/path', 'javascript:alert(1)'])('rejects %p', (input) => {
    expect(normalizeBaseUrl(input)).toBeNull();
  });
});

it('builds urls', () => {
  expect(baseUrlFor('1.2.3.4', 8765)).toBe('http://1.2.3.4:8765');
  expect(wsUrlFor('http://1.2.3.4:8765')).toBe('ws://1.2.3.4:8765/v1/ws');
});
