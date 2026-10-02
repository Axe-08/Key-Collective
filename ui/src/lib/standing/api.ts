/**
 * Key Collective — Standing API Client (WP-6.3 / T-6.3.2)
 */

import { sessionAuthTransport } from '../api/client';
import type { ContributorStandingData } from './types';

export async function fetchStanding(): Promise<ContributorStandingData> {
  const headers = sessionAuthTransport.getHeaders('GET');
  const res = await fetch('/api/pool/standing', {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch standing: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as ContributorStandingData;
  return data;
}
