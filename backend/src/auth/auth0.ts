import { auth } from 'express-oauth2-jwt-bearer';
import { RequestHandler } from 'express';
import { prisma } from '../database/prismaClient';
import { HttpError } from '../errors';

let verifier: RequestHandler | undefined;
export const UNAUTHORIZED = 'Unauthorized. Please login again.';

export function accessTokenVerifier(): RequestHandler {
  if (!verifier) {
    const issuerBaseURL = process.env.AUTH0_ISSUER_BASE_URL;
    const audience = process.env.AUTH0_AUDIENCE;
    if (!issuerBaseURL || !audience) {
      throw new HttpError(503, 'Sign-in is temporarily unavailable. Please try again later.');
    }
    verifier = auth({ issuerBaseURL, audience, tokenSigningAlg: 'RS256', clockTolerance: 0 });
  }
  return verifier;
}

export async function resolveAuth0User(subject: string, accessToken: string) {
  const existing = await prisma.user.findUnique({ where: { auth0UserId: subject } });
  if (existing) return existing;
  // API access tokens need not contain email/name. Fetch a trusted profile.
  const issuer = process.env.AUTH0_ISSUER_BASE_URL;
  if (!issuer) throw new HttpError(503, 'Sign-in is temporarily unavailable.');
  let profile: { sub?: unknown; email?: unknown; name?: unknown };
  try {
    const response = await fetch(`${issuer.replace(/\/$/, '')}/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Profile lookup failed');
    profile = await response.json();
  } catch {
    throw new HttpError(503, 'Sign-in is temporarily unavailable. Please try again.');
  }
  if (profile.sub !== subject || typeof profile.email !== 'string' || !profile.email.trim()) {
    throw new HttpError(401, UNAUTHORIZED);
  }
  try {
    return await prisma.user.create({ data: {
      auth0UserId: subject,
      email: profile.email.trim().toLowerCase(),
      name: typeof profile.name === 'string' ? profile.name : null,
    } });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      // Concurrent first requests reuse the subject. Email equality never links
      // a password account or another provider; Auth0 owns identity linking.
      const concurrent = await prisma.user.findUnique({ where: { auth0UserId: subject } });
      if (concurrent) return concurrent;
      throw new HttpError(503, 'Your account could not be created. Please try again.');
    }
    throw error;
  }
}
