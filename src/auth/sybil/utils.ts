/**
 * Key Collective v3 — Subnet, Email & ASN Verification Utilities
 */

import {
  DATACENTER_ASNS,
  DISPOSABLE_EMAIL_DOMAINS,
  SUBNET_VELOCITY_WINDOW_MS,
} from "./constants";
import type { SubnetTracker } from "./types";

/**
 * Extracts a normalized /24 subnet (IPv4) or /48 prefix (IPv6) from an IP address.
 */
export function extractSubnet(ip: string): string {
  if (!ip || typeof ip !== "string") {
    return "0.0.0.0/24";
  }

  const trimmed = ip.trim();

  // Handle IPv4
  const ipv4Parts = trimmed.split(".");
  if (ipv4Parts.length === 4) {
    const p0 = Number(ipv4Parts[0]);
    const p1 = Number(ipv4Parts[1]);
    const p2 = Number(ipv4Parts[2]);
    const p3 = Number(ipv4Parts[3]);

    if (
      !Number.isNaN(p0) && p0 >= 0 && p0 <= 255 &&
      !Number.isNaN(p1) && p1 >= 0 && p1 <= 255 &&
      !Number.isNaN(p2) && p2 >= 0 && p2 <= 255 &&
      !Number.isNaN(p3) && p3 >= 0 && p3 <= 255
    ) {
      return `${p0}.${p1}.${p2}.0/24`;
    }
  }

  // Handle IPv6
  if (trimmed.includes(":")) {
    const segments = trimmed.split(":").filter((s) => s.length > 0);
    if (segments.length >= 3) {
      return `${segments[0]}:${segments[1]}:${segments[2]}::/48`;
    }
    return `${trimmed}::/48`;
  }

  return `${trimmed}/24`;
}

/**
 * Validates whether an email domain is in the disposable burner domain blocklist.
 * Supports exact domain matches and subdomains (e.g. sub.mailinator.com).
 */
export function isDisposableEmail(email: string): boolean {
  if (!email || typeof email !== "string") {
    return true;
  }

  const atIndex = email.lastIndexOf("@");
  if (atIndex === -1 || atIndex === email.length - 1) {
    return true; // Malformed email
  }

  const fullDomain = email.slice(atIndex + 1).toLowerCase().trim();
  if (!fullDomain) {
    return true;
  }

  if (DISPOSABLE_EMAIL_DOMAINS.has(fullDomain)) {
    return true;
  }

  // Check subdomains
  const parts = fullDomain.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    const parentDomain = parts.slice(i).join(".");
    if (DISPOSABLE_EMAIL_DOMAINS.has(parentDomain)) {
      return true;
    }
  }

  return false;
}

/**
 * Checks whether an ASN belongs to known datacenter, cloud, or VPN hosting providers.
 */
export function isDatacenterAsn(asn: number | string | undefined): boolean {
  if (asn === undefined || asn === null) {
    return false;
  }
  const numericAsn = typeof asn === "string" ? Number(asn.replace(/[^0-9]/g, "")) : asn;
  return DATACENTER_ASNS.has(numericAsn);
}

/**
 * In-memory sliding-window subnet registration tracker with TTL cleanup.
 */
export class InMemorySubnetTracker implements SubnetTracker {
  private readonly registrations = new Map<string, number[]>();

  public getSubnetRegistrationCount(
    subnet: string,
    windowMs = SUBNET_VELOCITY_WINDOW_MS,
    nowMs = Date.now()
  ): number {
    const timestamps = this.registrations.get(subnet);
    if (!timestamps || timestamps.length === 0) {
      return 0;
    }

    const cutoff = nowMs - windowMs;
    const active = timestamps.filter((ts) => ts > cutoff);
    if (active.length !== timestamps.length) {
      if (active.length > 0) {
        this.registrations.set(subnet, active);
      } else {
        this.registrations.delete(subnet);
      }
    }
    return active.length;
  }

  public recordRegistration(subnet: string, timestamp = Date.now()): void {
    const existing = this.registrations.get(subnet) ?? [];
    existing.push(timestamp);
    this.registrations.set(subnet, existing);
  }

  public reset(): void {
    this.registrations.clear();
  }
}

// Global default tracker instance
export const globalSubnetTracker = new InMemorySubnetTracker();
