import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { needsOnboarding } from "./firstRun";

export const WELCOME_PATH = "/welcome";

/**
 * Mount once in the app shell. On launch, sends a first-time collector from any page to
 * /welcome (R28). Never sends anyone away from /welcome, and never redirects a collector who
 * finished onboarding or already has wines.
 */
export function FirstRunRedirect() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathRef = useRef(pathname);
  const checked = useRef(false);

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    void needsOnboarding().then((needed) => {
      if (needed && pathRef.current !== WELCOME_PATH)
        void navigate(WELCOME_PATH, { replace: true });
    });
  }, [navigate]);

  return null;
}
