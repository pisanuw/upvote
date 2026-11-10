import { googleGMarkup } from "@/lib/google-g";

/**
 * The Google sign-in button under Google's branding guidelines
 * (https://developers.google.com/identity/branding-guidelines), the same
 * button as the HintWise app template: one of Google's own button texts; the
 * standard G from signin-assets.zip, unmodified; the light theme (fill
 * #FFFFFF, 1px stroke #747775, text #1F1F1F); Google Sans Medium (Roboto or
 * Arial where it is not installed) at 14px on a 20px line; 12px before the
 * logo, 10px after it, 12px after the text; pill shape, 40px high.
 */
export const GOOGLE_BUTTON_TEXTS = ["Sign in with Google", "Continue with Google"] as const;
export type GoogleButtonText = (typeof GOOGLE_BUTTON_TEXTS)[number];

/**
 * The shared shape and type of the sign-in buttons, so the magic-link button
 * is exactly as prominent as the Google one, never more.
 */
export const SIGN_IN_BUTTON_CLASS =
  "inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-[#747775] bg-white px-3 font-['Google_Sans',Roboto,Arial,sans-serif] text-[14px] font-medium leading-5 text-[#1F1F1F] hover:bg-[#F8F9FA] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B57D0] disabled:cursor-default disabled:opacity-60";

/**
 * On narrow screens a `compact` button is Google's icon-only button: the G
 * alone in a 40x40 pill (9px + 20px + 9px inside the 1px stroke), with the
 * text kept for screen readers.
 */
export const COMPACT_BUTTON_CLASS = "max-sm:w-10 max-sm:px-[9px]";
export const COMPACT_TEXT_CLASS = "max-sm:sr-only";

export function GoogleSignInButton({
  text = "Continue with Google",
  compact = false,
  onClick,
}: {
  text?: GoogleButtonText;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={compact ? `${SIGN_IN_BUTTON_CLASS} ${COMPACT_BUTTON_CLASS}` : SIGN_IN_BUTTON_CLASS}
    >
      <span
        className={`${compact ? "sm:mr-[10px]" : "mr-[10px]"} inline-flex h-5 w-5 flex-none`}
        // A constant: Google's asset, embedded at build time (src/lib/google-g.ts).
        dangerouslySetInnerHTML={{ __html: googleGMarkup() }}
      />
      <span className={compact ? COMPACT_TEXT_CLASS : undefined}>{text}</span>
    </button>
  );
}
