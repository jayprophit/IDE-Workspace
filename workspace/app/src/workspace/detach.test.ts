import { describe, expect, it, vi } from 'vitest';
import {
  closeDetachedHandle,
  detachUrl,
  openDetachedWindow,
  parseDetachRequest,
  type DetachedHandle,
} from './detach';

function handle(over: Partial<DetachedHandle> = {}): DetachedHandle {
  return { closed: false, close: vi.fn(), focus: vi.fn(), ...over };
}

describe('detach URL contract', () => {
  it('builds same-origin URLs carrying only the panel id', () => {
    expect(detachUrl('http://127.0.0.1:5199/', 'inspector')).toBe('http://127.0.0.1:5199/?detach=inspector');
    expect(detachUrl('http://x/?mode=work', 'agent')).toBe('http://x/?detach=agent');
  });
  it('parses valid ids and rejects everything else without throwing', () => {
    expect(parseDetachRequest('http://x/?detach=inspector')).toBe('inspector');
    expect(parseDetachRequest('http://x/')).toBeNull();
    expect(parseDetachRequest('http://x/?detach=evil')).toBeNull();
    expect(parseDetachRequest('http://x/?detach=')).toBeNull();
    expect(parseDetachRequest('not a url')).toBeNull();
  });
});

describe('detach lifecycle', () => {
  it('opens real windows and reports blocked popups honestly', () => {
    const opened: string[] = [];
    const opener = {
      open: (url: string) => {
        opened.push(url);
        return handle();
      },
    };
    const ok = openDetachedWindow(opener, 'http://127.0.0.1:5199/', 'agent');
    expect(ok.blocked).toBe(false);
    expect(ok.handle).not.toBeNull();
    expect(opened).toEqual(['http://127.0.0.1:5199/?detach=agent']);
    const blocked = openDetachedWindow({ open: () => null }, 'http://x/', 'agent');
    expect(blocked).toEqual({ handle: null, blocked: true });
    const throwing = openDetachedWindow(
      {
        open: () => {
          throw new Error('denied');
        },
      },
      'http://x/',
      'agent',
    );
    expect(throwing.blocked).toBe(true);
  });
  it('reattach closes live handles and tolerates dead ones', () => {
    const live = handle();
    expect(closeDetachedHandle(live)).toBe(true);
    expect(live.close).toHaveBeenCalledTimes(1);
    expect(closeDetachedHandle(handle({ closed: true }))).toBe(false);
    expect(closeDetachedHandle(null)).toBe(false);
  });
});
