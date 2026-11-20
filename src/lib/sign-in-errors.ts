/**
 * Plain words for sign-in errors: NextAuth's `?error=` codes (it sends sign-in
 * errors to the sign-in page, pages.signIn), the email form's own codes and
 * the sign-in code's (src/lib/sign-in-code.ts). An unknown code gets the
 * Default message; the code itself is never shown, since anyone can put any
 * text in a link.
 */
import { MAX_CODES_PER_HOUR, SIGN_IN_CODE_LENGTH } from "@/lib/sign-in-code";

const GOOGLE_DID_NOT_FINISH = "Google sign-in did not finish. Try again, or get a sign-in code by email.";

const MESSAGES = new Map<string, string>([
  // The email form's own codes.
  ["EmailRequired", "Enter your email address."],
  ["EmailInvalid", "Enter a full email address, like name@example.com."],
  ["Network", "We could not reach UpvoteMe just now. Check your connection and try again."],
  ["CodeRequired", `Enter the ${SIGN_IN_CODE_LENGTH}-digit code from the email.`],
  ["CodeInvalid", `A sign-in code is ${SIGN_IN_CODE_LENGTH} digits. Check the email and type the code again.`],
  ["CodeWrong", "That code is wrong or has expired. Check the email and try again, or send a new code."],
  ["CodeTooManyTries", "Too many wrong tries for this code, so it no longer works. Send a new code."],
  // The server's answers to a code request.
  [
    "EmailCodeWait",
    "We sent a code to this address less than a minute ago. Check your email, or wait a minute and send a new code.",
  ],
  [
    "EmailCodeLimit",
    `We have sent ${MAX_CODES_PER_HOUR} codes to this address in the last hour. Use the newest one, or try again later.`,
  ],
  // NextAuth's codes.
  ["EmailSignin", "We could not send a sign-in code to that address. Check the address and try again."],
  ["Verification", "That sign-in link has expired or has already been used. Enter your email to get a sign-in code."],
  [
    "OAuthAccountNotLinked",
    "That email address already signs in another way. Sign in the way you did before, for example with an emailed code.",
  ],
  ["Signin", GOOGLE_DID_NOT_FINISH],
  ["OAuthSignin", GOOGLE_DID_NOT_FINISH],
  ["OAuthCallback", GOOGLE_DID_NOT_FINISH],
  ["OAuthCreateAccount", GOOGLE_DID_NOT_FINISH],
  ["Callback", GOOGLE_DID_NOT_FINISH],
  ["EmailCreateAccount", "We could not create an account for that email address. Try again."],
  [
    "AccessDenied",
    "That sign-in was not allowed. If you used Google, check that your Google account's email address is verified.",
  ],
  ["SessionRequired", "Sign in to see that page."],
  ["CredentialsSignin", "Sign-in failed. Try again."],
  ["Configuration", "Sign-in is not working on our side right now. Try again later."],
  ["Default", "Something went wrong while signing you in. Try again."],
]);

export function signInErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return MESSAGES.get(code) ?? MESSAGES.get("Default")!;
}
