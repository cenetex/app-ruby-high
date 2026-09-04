import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { StoredPasskeyCredential } from "./state-store.js";

export interface PasskeyRelyingParty {
  id: string;
  name: string;
  origin: string;
}

export interface VerifiedPasskeyRegistration {
  id: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
}

interface RegistrationVerificationInput {
  response: unknown;
  expectedChallenge: string;
  relyingParty: PasskeyRelyingParty;
}

interface AuthenticationVerificationInput extends RegistrationVerificationInput {
  credential: StoredPasskeyCredential;
}

type RegistrationVerifier = (input: RegistrationVerificationInput) => Promise<VerifiedPasskeyRegistration>;
type AuthenticationVerifier = (input: AuthenticationVerificationInput) => Promise<{ newCounter: number }>;

let registrationVerifierOverride: RegistrationVerifier | null = null;
let authenticationVerifierOverride: AuthenticationVerifier | null = null;

export function setPasskeyAuthVerifiersForTest(overrides: {
  registration?: RegistrationVerifier | null;
  authentication?: AuthenticationVerifier | null;
}): () => void {
  const previousRegistration = registrationVerifierOverride;
  const previousAuthentication = authenticationVerifierOverride;
  if (Object.prototype.hasOwnProperty.call(overrides, "registration")) {
    registrationVerifierOverride = overrides.registration ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(overrides, "authentication")) {
    authenticationVerifierOverride = overrides.authentication ?? null;
  }
  return () => {
    registrationVerifierOverride = previousRegistration;
    authenticationVerifierOverride = previousAuthentication;
  };
}

export async function passkeyRegistrationOptions(input: {
  userId: string;
  displayName?: string | null;
  relyingParty: PasskeyRelyingParty;
  existingCredentials?: StoredPasskeyCredential[];
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const displayName = cleanDisplayName(input.displayName);
  return generateRegistrationOptions({
    rpName: input.relyingParty.name,
    rpID: input.relyingParty.id,
    userID: new TextEncoder().encode(input.userId),
    userName: `${displayName} · ${input.userId.slice(-6)}`,
    userDisplayName: displayName,
    timeout: 60_000,
    attestationType: "none",
    excludeCredentials: (input.existingCredentials ?? []).map((credential) => ({
      id: credential.id,
      ...(credential.transports?.length ? { transports: credential.transports } : {}),
    })),
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
  });
}

export async function passkeyAuthenticationOptions(
  relyingParty: PasskeyRelyingParty,
  credentials?: StoredPasskeyCredential[],
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: relyingParty.id,
    timeout: 60_000,
    userVerification: "required",
    ...(credentials?.length
      ? {
          allowCredentials: credentials.map((credential) => ({
            id: credential.id,
            ...(credential.transports?.length ? { transports: credential.transports } : {}),
          })),
        }
      : {}),
  });
}

export async function verifyPasskeyRegistration(
  input: RegistrationVerificationInput,
): Promise<VerifiedPasskeyRegistration> {
  if (registrationVerifierOverride) return registrationVerifierOverride(input);
  const response = passkeyRegistrationResponse(input.response);
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: input.expectedChallenge,
    expectedOrigin: input.relyingParty.origin,
    expectedRPID: input.relyingParty.id,
    requireUserVerification: true,
  });
  if (!result.verified || !result.registrationInfo) {
    throw new Error("Passkey registration could not be verified.");
  }
  const credential = result.registrationInfo.credential;
  return {
    id: credential.id,
    publicKey: encodeBase64url(credential.publicKey),
    counter: credential.counter,
    ...(credential.transports?.length ? { transports: credential.transports } : {}),
    deviceType: result.registrationInfo.credentialDeviceType,
    backedUp: result.registrationInfo.credentialBackedUp,
  };
}

export async function verifyPasskeyAuthentication(
  input: AuthenticationVerificationInput,
): Promise<{ newCounter: number }> {
  if (authenticationVerifierOverride) return authenticationVerifierOverride(input);
  const result = await verifyAuthenticationResponse({
    response: passkeyAuthenticationResponse(input.response),
    expectedChallenge: input.expectedChallenge,
    expectedOrigin: input.relyingParty.origin,
    expectedRPID: input.relyingParty.id,
    credential: {
      id: input.credential.id,
      publicKey: decodeBase64url(input.credential.publicKey),
      counter: input.credential.counter,
      ...(input.credential.transports?.length ? { transports: input.credential.transports } : {}),
    },
    requireUserVerification: true,
  });
  if (!result.verified) throw new Error("Passkey sign-in could not be verified.");
  return { newCounter: result.authenticationInfo.newCounter };
}

export function passkeyCredentialId(response: unknown): string {
  if (!response || typeof response !== "object") return "";
  const id = (response as { id?: unknown }).id;
  return typeof id === "string" ? id.trim() : "";
}

function passkeyRegistrationResponse(response: unknown): RegistrationResponseJSON {
  if (!response || typeof response !== "object") throw new Error("Passkey response is missing.");
  return response as RegistrationResponseJSON;
}

function passkeyAuthenticationResponse(response: unknown): AuthenticationResponseJSON {
  if (!response || typeof response !== "object") throw new Error("Passkey response is missing.");
  return response as AuthenticationResponseJSON;
}

function cleanDisplayName(value: string | null | undefined): string {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  return clean && clean !== "Guest" ? clean.slice(0, 64) : "Ruby High Student";
}

function encodeBase64url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64url(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(value, "base64url"));
}
