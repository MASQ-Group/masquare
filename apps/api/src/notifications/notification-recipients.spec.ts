import { describe, expect, it } from 'vitest';
import { recipientsFor, type NotifiableUser } from './notification-recipients';

const user = (id: string, over: Partial<NotifiableUser> = {}): NotifiableUser => ({
  id,
  isAdmin: false,
  status: 'active',
  deletedAt: null,
  role: null,
  accessOverrides: null,
  ...over,
});

const withArea = (id: string, area: string, level: string) => user(id, { role: { grants: { areas: { [area]: level } } } });

describe('who is told', () => {
  it('tells the people named', () => {
    expect(recipientsFor({ userIds: ['a', 'b'] }, [user('a'), user('b'), user('c')])).toEqual(['a', 'b']);
  });

  it('tells whoever may work in the area', () => {
    const users = [withArea('warehouse', 'shipments', 'edit'), withArea('buyer', 'purchasing', 'edit'), user('nobody')];
    expect(recipientsFor({ area: 'shipments' }, users)).toEqual(['warehouse']);
  });

  it('counts read access as enough to be told, by default', () => {
    expect(recipientsFor({ area: 'shipments' }, [withArea('reader', 'shipments', 'view')])).toEqual(['reader']);
  });

  it('can insist on edit access, for news only a doer can act on', () => {
    const users = [withArea('reader', 'shipments', 'view'), withArea('doer', 'shipments', 'edit')];
    expect(recipientsFor({ area: 'shipments', level: 'edit' }, users)).toEqual(['doer']);
  });

  it('includes admins, who hold every area', () => {
    expect(recipientsFor({ area: 'shipments' }, [user('boss', { isAdmin: true })])).toEqual(['boss']);
  });

  it('can leave admins out of an area-wide notice', () => {
    const users = [user('boss', { isAdmin: true }), withArea('warehouse', 'shipments', 'edit')];
    expect(recipientsFor({ area: 'shipments', excludeAdmins: true }, users)).toEqual(['warehouse']);
  });

  /** An override that revokes must revoke here too, or a notification shows what a screen will not. */
  it('honours an override that takes the area away', () => {
    const revoked = user('ex', { role: { grants: { areas: { shipments: 'edit' } } }, accessOverrides: { areas: { shipments: 'none' } } });
    expect(recipientsFor({ area: 'shipments' }, [revoked])).toEqual([]);
  });
});

describe('who is not told', () => {
  /**
   * The rule the whole file exists for: a list that tells people what they just did is a list people
   * learn to ignore, and the cost is the notifications that mattered.
   */
  it('never tells the person who caused it', () => {
    const users = [withArea('filer', 'shipments', 'edit'), withArea('other', 'shipments', 'edit')];
    expect(recipientsFor({ area: 'shipments', actorId: 'filer' }, users)).toEqual(['other']);
  });

  it('will not tell them even when they are named outright', () => {
    expect(recipientsFor({ userIds: ['a', 'b'], actorId: 'a' }, [user('a'), user('b')])).toEqual(['b']);
  });

  it('skips a suspended account', () => {
    expect(recipientsFor({ area: 'shipments' }, [withArea('gone', 'shipments', 'edit'), user('x')].map((u) => (u.id === 'gone' ? { ...u, status: 'suspended' } : u)))).toEqual([]);
  });

  it('skips a deleted one', () => {
    const deleted = { ...withArea('gone', 'shipments', 'edit'), deletedAt: new Date() };
    expect(recipientsFor({ area: 'shipments' }, [deleted])).toEqual([]);
  });

  it('ignores a named user who does not exist', () => {
    expect(recipientsFor({ userIds: ['ghost'] }, [user('a')])).toEqual([]);
  });
});

describe('the list itself', () => {
  it('names each person once, however many ways they qualify', () => {
    const both = withArea('a', 'shipments', 'edit');
    expect(recipientsFor({ userIds: ['a'], area: 'shipments' }, [both])).toEqual(['a']);
  });

  it('is empty when nobody qualifies, rather than falling back to everyone', () => {
    expect(recipientsFor({ area: 'repricing' }, [withArea('a', 'shipments', 'edit')])).toEqual([]);
  });
});
