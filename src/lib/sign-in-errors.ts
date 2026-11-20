/**
 * Plain words for sign-in errors: NextAuth's `?error=` codes (it sends sign-in
 * errors to the sign-in page, pages.signIn) and the email form's own codes.
 * An unknown code gets the Default message; the code itself is never shown,
 * since anyone can put any text in a link.
 */
const GOOGLE_DID_NOT_FINISH = "Google sign-in did not finish. Try again, or get a sign-in link by email.";

const MESSAGES = new Map<string, string>([
  // The email form's own codes.
  ["EmailRequired", "Enter your email address."],
  ["EmailInvalid", "Enter a full email address, like name@example.com."],
  ["Network", "We could not send the link just now. Check your connection and try again."],
  // NextAuth's codes.
  ["EmailSignin", "We could not send a sign-in link to that address. Check the address and try again."],
  ["Verification", "That sign-in link has expired or has already been used. Enter your email to get a new one."],
  [
    "OAuthAccountNotLinked",
    "That email address already signs in another way. Sign in the way you did before, for example with an email link.",
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
