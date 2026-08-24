import * as argon2 from 'argon2';

// Pinned to the OWASP baseline so silent upstream default changes cannot
// weaken hashing. Verification always follows the parameters embedded in
// the hash string, so previously stored hashes remain verifiable.
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const hashPassword = (password: string): Promise<string> =>
  argon2.hash(password, ARGON2_OPTIONS);

export const verifyPassword = (
  hash: string,
  password: string,
): Promise<boolean> => argon2.verify(hash, password);

const DUMMY_HASH = hashPassword('timing-equalizer');

/**
 * Performs the same argon2 work as a real credential check for requests
 * against unknown accounts, so response timing cannot be used to enumerate
 * registered emails. The result is discarded by design.
 */
export const runDummyPasswordVerification = async (
  password: string,
): Promise<void> => {
  await argon2.verify(await DUMMY_HASH, password);
};
