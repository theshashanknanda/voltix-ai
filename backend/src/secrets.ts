import path from 'path';

export const SECRET_MESSAGE =
  'This file looks like it contains a secret (a private key or credential), so it was not sent to the AI model. Remove the secret and try again.';

const SECRET_FILE = /^(\.env(\..+)?|id_(rsa|dsa|ecdsa|ed25519))$|\.(pem|key|p12|pfx)$/i;

// ponytail: a pattern list, not a secret scanner. It only catches private-key
// headers and credential names assigned a literal, so env lookups pass but
// placeholders such as "changeme1" are still blocked. Upgrade to a real
// scanner (entropy + provider token formats) if this misses or over-blocks.
const SECRET_CONTENT = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /(?:api_?key|secret|passw(?:or)?d|token)[\w-]*["']?\s*[:=]\s*(["'])[^\s"']{8,}\1/i,
  /^[A-Z0-9_]*(?:API_KEY|SECRET|PASSWORD|TOKEN)[A-Z0-9_]*=[^\s"'$;(){}]{8,}\r?$/m,
];

export const isSecretPath = (filePath: string): boolean => SECRET_FILE.test(path.posix.basename(filePath));

export const containsSecret = (text: string): boolean => SECRET_CONTENT.some((pattern) => pattern.test(text));
