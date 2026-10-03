import { afterEach, describe, expect, it } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import IdentityCard from './IdentityCard.svelte';
import type { UserAccount } from '../../../../src/contracts/v3_types';

const base: UserAccount = {
  id: 'usr_goog_jane',
  githubId: 0,
  githubUsername: '',
  primaryEmail: 'jane.doe@example.com',
  tier: 'builder',
  avatarUrl: '',
  isEmailVerified: false,
  githubCreatedAt: '',
  sybilScore: null,
  registrationIp: '',
  createdAt: '',
  updatedAt: '',
  authProvider: 'google',
};

async function render(account: UserAccount) {
  const card = mount(IdentityCard, { target: document.body, props: { account, onCreateKeyClick: () => {} } });
  await tick();
  return card;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('IdentityCard trust truth (WP-F.5, QA-02, QA-03)', () => {
  it('a Google-only account is Unverified with no GitHub checks, score or handle', async () => {
    const card = await render(base);
    const text = document.body.textContent ?? '';

    expect(text).toContain('Unverified — link GitHub');
    expect(text).not.toContain('/100');
    expect(text).not.toContain('GitHub Account Age');
    expect(text).not.toContain('Public Repositories');
    expect(text).not.toContain('Turnstile');
    expect(text).not.toContain('Subnet');
    expect(text).not.toContain('@jane.doe');
    expect(document.body.innerHTML).not.toContain('avatars.githubusercontent.com');
    expect(text).toContain('Google');
    unmount(card);
  });

  it('a GitHub-linked account shows its real score and checks from the stored GitHub profile', async () => {
    const createdAt = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const card = await render({
      ...base,
      githubId: 136698185,
      githubUsername: 'Axe-08',
      githubCreatedAt: createdAt,
      githubPublicRepos: 12,
      githubContributions: 340,
      sybilScore: 100,
      authProvider: 'github',
    });
    const text = document.body.textContent ?? '';

    expect(text).toContain('@Axe-08');
    expect(text).toContain('100/100');
    expect(text).not.toContain('Unverified');
    expect(text).toContain('GitHub Account Age');
    expect(text).toContain('400d');
    expect(text).toContain('12 repos');
    expect(text).toContain('340 contributions');
    expect(text).not.toContain('Turnstile');
    expect(text).not.toContain('Subnet');
    unmount(card);
  });

  it('a GitHub-linked account without stored profile data shows no invented checks', async () => {
    const card = await render({ ...base, githubId: 7, githubUsername: 'octo', sybilScore: 70, authProvider: 'github' });
    const text = document.body.textContent ?? '';

    expect(text).toContain('70/100');
    expect(text).not.toContain('GitHub Account Age');
    expect(text).not.toContain('Public Repositories');
    unmount(card);
  });
});
