import { customAlphabet } from "nanoid";

const shareAlphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const adminAlphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

const newShareCode = customAlphabet(shareAlphabet, 8);
const newAdminCode = customAlphabet(adminAlphabet, 16);

export function createShareCode() {
  return newShareCode();
}

export function createAdminCode() {
  return newAdminCode();
}

export function createAnonVoterKey() {
  return `anon_${customAlphabet(adminAlphabet, 24)()}`;
}
