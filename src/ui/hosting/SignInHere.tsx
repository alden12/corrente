/**
 * Signing in, on the hosted site run signed out (HOST-23.2.8): back to its sign-in screen, rather
 * than out to the online app's address, since this already is it.
 */
import { signInHere } from "../../hosting";
import { linkClass } from "./OnThisDevice";

export function SignInHere({ children = "Sign in" }: { children?: string }) {
  return (
    <button type="button" onClick={signInHere} className={`${linkClass} cursor-pointer`}>
      {children}
    </button>
  );
}
