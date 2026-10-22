/**
 * A hosted feature on a standalone run (HOST-23.2.7): the control stays where it would be, so people
 * learn it exists, but looks muted, and a press says what it needs rather than doing it. Shown
 * rather than hidden, so the standalone app reads as the same app, with the online parts pointed at.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { canSignInHere, hosting } from "../../hosting";
import { Popover } from "../Menu";
import { useDismiss } from "../useDismiss";
import { linkClass } from "./OnThisDevice";
import { SignInHere } from "./SignInHere";

/** Where the online app is: the interest form while it's invite-only, the app itself once open. */
function OnlineLink() {
  const { interest, hostedApp } = hosting.links;
  if (interest)
    return (
      <>
        It&apos;s in preview:{" "}
        <a href={interest} target="_blank" rel="noreferrer" className={linkClass}>
          register interest
        </a>
        .
        {canSignInHere && (
          <>
            {" "}
            Invited? <SignInHere>Sign in</SignInHere>.
          </>
        )}
      </>
    );
  if (canSignInHere) return <SignInHere>Sign in to use it</SignInHere>;
  if (hostedApp)
    return (
      <a href={hostedApp} target="_blank" rel="noreferrer" className={linkClass}>
        Open Corrente online
      </a>
    );
  return null;
}

export function HostedOnlyButton({
  feature,
  label,
  className,
  children,
}: {
  /** What it is, to start the sentence: "Sharing". */
  feature: string;
  /** The button's accessible name, where its content is an icon. */
  label?: string;
  className: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, triggerRef);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((was) => !was)}
        className={`${className} text-muted border-dashed`}
      >
        {children}
      </button>
      {open && (
        <Popover
          anchorRef={triggerRef}
          strategy="below"
          side="left"
          role="dialog"
          label={`${feature} is part of Corrente online`}
          onDetached={close}
        >
          {() => (
            <p className="w-64 px-3.5 py-2.5 text-[12.5px] leading-snug text-ink">
              {feature} is part of Corrente online. <OnlineLink />
            </p>
          )}
        </Popover>
      )}
    </>
  );
}
