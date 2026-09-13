import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { usePostHog } from "@posthog/react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  AlertCircleIcon,
} from "@hugeicons/core-free-icons";
import { Avatar, Icon, Logo } from "./ui";
import { authClient } from "../lib/auth-client";
import { ButtonLoader } from "./button-loader";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { firebaseAuth } from "../lib/firebase";
import { formatPageTitle } from "../lib/page-title";

type AuthMode = "sign-in" | "sign-up";
type SocialProvider = "google" | "discord" | "github";
type Errors = Partial<Record<"email" | "password" | "name", string>>;

const copy = {
  "sign-in": {
    title: "Hey, welcome back.",
    description: "The conversation’s better with you in it.",
    submit: "Sign in",
    aside: (
      <>
        Right where <br />
        you <em>belong.</em>
      </>
    ),
  },
  "sign-up": {
    title: "Good to have you.",
    description: null,
    submit: "Create account",
    aside: (
      <>
        It starts with <br />a little <em>hello.</em>
      </>
    ),
  },
};

function formatFirebaseError(
  code?: string,
  fallback = "Authentication failed. Please try again.",
): string {
  switch (code) {
    case "auth/email-already-in-use":
      return "An account with this email already exists. Try signing in instead.";
    case "auth/invalid-email":
      return "That email doesn’t look quite right. Try again?";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password. Please try again.";
    case "auth/weak-password":
      return "Password must be at least 6 characters long.";
    case "auth/too-many-requests":
      return "Too many failed attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network error. Please check your internet connection and try again.";
    default:
      return fallback;
  }
}

export function AuthScreen({ mode }: { mode: AuthMode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [socialNotice, setSocialNotice] = useState<SocialProvider | null>(null);
  const [busyAction, setBusyAction] = useState<
    "submit" | "reset" | SocialProvider | null
  >(null);
  const busy = busyAction !== null;
  const [serverError, setServerError] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const content = copy[mode];
  const signup = mode === "sign-up";
  const posthog = usePostHog();
  const browserTitle = formatPageTitle(
    signup ? "Create your account" : "Sign in",
  );

  useEffect(() => {
    document.title = browserTitle;
  }, [browserTitle]);

  function authDestination() {
    const next = new URLSearchParams(window.location.search).get("next");
    if (signup) return "/app/welcome";
    const safeNext =
      next &&
      !next.includes("\\") &&
      (next === "/app" ||
        next.startsWith("/app/") ||
        next.startsWith("/invite/"))
        ? next
        : "/app";
    return safeNext;
  }

  async function syncSessionWithBackend(params: {
    idToken: string;
    email?: string | null;
    name?: string | null;
    photoUrl?: string | null;
    uid: string;
  }) {
    const response = await fetch("/api/auth/firebase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(
        err.error || "Authentication sync failed. Please try again.",
      );
    }

    const data = (await response.json()) as { isNewUser?: boolean };
    if (data.isNewUser || signup) {
      window.location.assign("/app/welcome");
    } else {
      window.location.assign(authDestination());
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const nextErrors: Errors = {};
    const trimmedEmail = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      nextErrors.email = "That email doesn’t look quite right. Try again?";
    }
    if (!password || password.length < 6) {
      nextErrors.password = "Password must be at least 6 characters.";
    }
    if (signup && name.trim().length > 0 && name.trim().length < 2) {
      nextErrors.name = "Name must be at least 2 characters.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      if (nextErrors.email) emailRef.current?.focus();
      else if (nextErrors.password) passwordRef.current?.focus();
      return;
    }

    setBusyAction("submit");
    setServerError("");
    setResetSent(false);

    try {
      if (signup) {
        const userCredential = await createUserWithEmailAndPassword(
          firebaseAuth,
          trimmedEmail,
          password,
        );
        const idToken = await userCredential.user.getIdToken();
        posthog.capture("sign_up_started", { mode });

        await syncSessionWithBackend({
          idToken,
          email: userCredential.user.email,
          name: name.trim() || userCredential.user.displayName,
          photoUrl: userCredential.user.photoURL,
          uid: userCredential.user.uid,
        });
      } else {
        const userCredential = await signInWithEmailAndPassword(
          firebaseAuth,
          trimmedEmail,
          password,
        );
        const idToken = await userCredential.user.getIdToken();
        posthog.capture("sign_in_started", { mode });

        await syncSessionWithBackend({
          idToken,
          email: userCredential.user.email,
          name: userCredential.user.displayName,
          photoUrl: userCredential.user.photoURL,
          uid: userCredential.user.uid,
        });
      }
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      setServerError(formatFirebaseError(err?.code, err?.message));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleForgotPassword() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setErrors({
        email: "Enter your email address first so we know where to send the reset link.",
      });
      emailRef.current?.focus();
      return;
    }

    setBusyAction("reset");
    setServerError("");
    try {
      await sendPasswordResetEmail(firebaseAuth, trimmedEmail);
      setResetSent(true);
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      setServerError(formatFirebaseError(err?.code, err?.message));
    } finally {
      setBusyAction(null);
    }
  }

  async function signInWith(provider: SocialProvider) {
    if (busy) return;
    setBusyAction(provider);
    setSocialNotice(null);
    setServerError("");
    posthog.capture(`${provider}_sign_in_clicked`, { mode });

    if (provider === "google") {
      try {
        const googleProvider = new GoogleAuthProvider();
        googleProvider.setCustomParameters({ prompt: "select_account" });
        const userCredential = await signInWithPopup(
          firebaseAuth,
          googleProvider,
        );
        const idToken = await userCredential.user.getIdToken();

        await syncSessionWithBackend({
          idToken,
          email: userCredential.user.email,
          name: userCredential.user.displayName,
          photoUrl: userCredential.user.photoURL,
          uid: userCredential.user.uid,
        });
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        if (
          err?.code === "auth/popup-closed-by-user" ||
          err?.code === "auth/cancelled-popup-request"
        ) {
          return;
        }
        if (
          err?.code === "auth/configuration-not-found" ||
          err?.code === "auth/operation-not-allowed"
        ) {
          setSocialNotice("google");
          return;
        }
        setServerError(formatFirebaseError(err?.code, err?.message));
      } finally {
        setBusyAction(null);
      }
      return;
    }

    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: authDestination(),
      });
      if (result.error) setSocialNotice(provider);
    } catch {
      setSocialNotice(provider);
    } finally {
      setBusyAction(null);
    }
  }

  function clearError(field: keyof Errors) {
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  }

  return (
    <main
      id="main"
      data-ui="auth-page"
      className="min-h-svh flex max-[580px]:block"
    >
      <aside
        data-ui="auth-story"
        className="relative w-[44%] shrink-0 bg-[#f3653f] pt-10.5 pb-8.5 px-12 flex flex-col text-[#44261d] overflow-hidden **:data-[ui~=logo-period]:text-[#ffe4c8] [&_h1]:text-[clamp(49px,4.8vw,75px)] [&_h1]:leading-[1.06] [&_h1]:tracking-[-0.065em] [&_h1]:font-[550] [&_h1]:mt-5.25 [&_h1]:mb-6.5 [&_h1]:mx-0 [&_h1_em]:text-[#ffebd3] [&_h1_em]:not-italic min-[1600px]:px-17.5 min-[1600px]:[&_h1]:text-[80px] max-[1100px]:px-8.5 max-[1100px]:[&_h1]:text-[58px] max-[800px]:w-[41%] max-[800px]:px-6 max-[800px]:[&_h1]:text-[45px] max-[580px]:w-full max-[580px]:p-6 max-[580px]:**:data-[ui~=logo]:text-[26px] max-[580px]:[&_h1]:text-[45px] max-[580px]:[&_h1]:mt-2.75 max-[580px]:[&_h1]:mb-0 max-[580px]:[&_h1]:mx-0 max-[580px]:[&_h1]:leading-none max-[580px]:[&_h1_em]:whitespace-nowrap"
      >
        <Logo />
        <div
          data-ui="auth-story-main"
          className="w-full max-w-115 m-auto py-[76px_70px] [&>p]:text-[16px] [&>p]:leading-[1.65] [&>p]:text-[#833c26] [&>p]:m-0 min-[1600px]:max-w-122.5 max-[1100px]:[&>p]:text-[14px] max-[800px]:[&>p]:text-[13px] max-[580px]:pt-7.75 max-[580px]:px-0 max-[580px]:max-w-none max-[580px]:pb-4.25 max-[580px]:[&>p]:hidden"
        >
          <h1>{content.aside}</h1>
          <p>
            For your people, your projects,
            <br />
            and your beautifully specific interests.
          </p>
          <div
            data-ui="auth-conversation"
            className="mt-12.75 py-0 px-1.25 max-[800px]:mt-9.25 max-[800px]:p-0 max-[580px]:hidden"
          >
            <div
              data-ui="auth-message"
              className="flex items-center gap-3 w-[90%] min-w-62 bg-[#fffaf0] border border-solid border-[#eac6ad] p-4.5 rounded-[10px] transform-[rotate(-4deg)] shadow-[0_10px_20px_#7d2c1110] **:data-[ui~=avatar]:size-8.5 [&_p]:text-[12px] [&_p]:mt-1.25 [&_p]:mb-0 [&_p]:mx-0 [&_p]:text-[#93826f] max-[1100px]:min-w-56 max-[1100px]:p-3.5 max-[1100px]:[&_p]:text-[11px] max-[800px]:min-w-0 max-[800px]:w-full max-[800px]:py-3.25 max-[800px]:px-2.25 max-[800px]:gap-1.75 max-[800px]:**:data-[ui~=avatar]:text-[10px] max-[800px]:**:data-[ui~=avatar]:rounded-lg max-[800px]:**:data-[ui~=avatar]:size-6.25 max-[800px]:[&_p]:text-[10px]"
            >
              <Avatar name="Jamie" color="purple" />
              <div>
                <div
                  data-ui="auth-message-meta"
                  className="flex items-center gap-3 [&_strong]:text-[12px] [&_strong]:text-[#5b554a] [&>span]:text-[9px] [&>span]:text-[#b6a794] max-[800px]:[&_strong]:text-[10px] max-[800px]:[&>span]:hidden"
                >
                  <strong>Jamie</strong>
                  <span>just now</span>
                </div>
                <p>hey! saved you a spot. 👋</p>
              </div>
            </div>
            <div
              data-ui="auth-message reply"
              className="flex items-center gap-3 w-[90%] min-w-62 bg-[#fffaf0] border border-solid border-[#eac6ad] p-4.5 rounded-[10px] transform-[rotate(-4deg)] shadow-[0_10px_20px_#7d2c1110] **:data-[ui~=avatar]:size-8.5 [&_p]:text-[12px] [&_p]:mt-1.25 [&_p]:mb-0 [&_p]:mx-0 [&_p]:text-[#93826f] data-[ui~=reply]:ml-6.75 data-[ui~=reply]:mt-4 data-[ui~=reply]:transform-[rotate(3deg)] max-[1100px]:min-w-56 max-[1100px]:p-3.5 max-[1100px]:[&_p]:text-[11px] max-[1100px]:data-[ui~=reply]:ml-3 max-[800px]:min-w-0 max-[800px]:w-full max-[800px]:py-3.25 max-[800px]:px-2.25 max-[800px]:gap-1.75 max-[800px]:**:data-[ui~=avatar]:text-[10px] max-[800px]:**:data-[ui~=avatar]:rounded-lg max-[800px]:**:data-[ui~=avatar]:size-6.25 max-[800px]:[&_p]:text-[10px] max-[800px]:data-[ui~=reply]:ml-0.5"
            >
              <Avatar name="You" color="green" />
              <div>
                <div
                  data-ui="auth-message-meta"
                  className="flex items-center gap-3 [&_strong]:text-[12px] [&_strong]:text-[#5b554a] [&>span]:text-[9px] [&>span]:text-[#b6a794] max-[800px]:[&_strong]:text-[10px] max-[800px]:[&>span]:hidden"
                >
                  <strong>You</strong>
                  <span>just now</span>
                </div>
                <p>feels like my kind of place.</p>
              </div>
              <span
                data-ui="auth-reaction"
                className="absolute -bottom-3.75 right-4.5 bg-[#ffead3] border border-solid border-[#e1b697] py-1 px-2.25 rounded-md text-[12px] text-[#9b7355] max-[800px]:text-[10px] max-[800px]:-bottom-3.25"
              >
                🧡 3
              </span>
            </div>
          </div>
        </div>
      </aside>
      <section
        data-ui="auth-form-side"
        className="flex-1 min-w-0 pt-10.25 pb-6.5 px-12.25 flex flex-col min-[1600px]:px-17.5 max-[1100px]:px-8.5 max-[800px]:px-7 max-[580px]:pt-5 max-[580px]:pb-6.25 max-[580px]:px-6.25 max-[580px]:min-h-[calc(100svh-220px)]"
      >
        <div
          data-ui="auth-topbar"
          className="flex items-center justify-between gap-4 w-full text-[11px] text-[#949486] [&>span>a]:inline-flex [&>span>a]:items-center [&>span>a]:gap-0.5 [&>span>a]:text-[#454b3e] [&>span>a]:ml-1.5 [&>span>a]:font-semibold [&_a:hover]:text-[#cf4c29] max-[1100px]:text-[10px] max-[800px]:[&>span]:hidden max-[580px]:text-[11px] max-[580px]:[&>span]:block max-[580px]:[&>span]:text-[10px]"
        >
          <Link
            to="/"
            data-ui="back-home"
            className="flex items-center gap-1.5 text-[#727769]"
          >
            <Icon icon={ArrowLeft01Icon} size={16} /> Back to home
          </Link>
          <span>
            {signup ? "Already one of us?" : "New around here?"}{" "}
            <Link to={signup ? "/sign-in" : "/sign-up"}>
              {signup ? "Log in" : "Join us"}{" "}
              <Icon icon={ArrowUpRight01Icon} size={14} />
            </Link>
          </span>
        </div>
        <div
          data-ui="auth-form-wrap"
          className="w-full max-w-93 m-auto py-18.75 min-[1600px]:max-w-102.5 max-[800px]:py-13.75 max-[580px]:py-[38px_46px] max-[580px]:max-w-95"
        >
          <div
            data-ui="auth-heading"
            className="[&_h2]:text-[37px] [&_h2]:mt-0 [&_h2]:mb-3.25 [&_h2]:tracking-[-1.8px] [&_h2]:font-semibold [&>p]:text-[#707662] [&>p]:text-[14px] [&>p]:leading-[1.7] [&>p]:mt-0 [&>p]:mb-7 [&>p]:mx-0 max-[800px]:[&_h2]:text-[32px] max-[800px]:[&>p]:text-[13px] max-[580px]:[&_h2]:text-[34px] max-[580px]:[&>p]:text-[14px] max-[580px]:[&>p]:mb-6"
          >
            <h2>{content.title}</h2>
            {content.description && <p>{content.description}</p>}
          </div>

          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              data-ui="social-button google"
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-solid border-[#d9dbcf] bg-white text-[14px] font-semibold text-[#3c4043] transition-[background,border-color,box-shadow] hover:border-[#b7c0a7] hover:bg-[#f8f9fa] shadow-[0_1px_2px_rgba(0,0,0,0.05)] max-[580px]:min-h-12 max-[580px]:text-[13px]"
              disabled={busy}
              onClick={() => void signInWith("google")}
            >
              {busyAction === "google" ? (
                <ButtonLoader label="Connecting to Google" />
              ) : (
                <>
                  <img
                    src="/icons/google.svg"
                    alt=""
                    aria-hidden="true"
                    className="size-5"
                  />
                  Continue with Google
                </>
              )}
            </button>
            <button
              type="button"
              data-ui="social-button discord"
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-solid border-[#5865f2] bg-[#5865f2] text-[14px] font-semibold text-white transition-[background,border-color] hover:border-[#4f5bd5] hover:bg-[#4f5bd5] max-[580px]:min-h-12 max-[580px]:text-[13px]"
              disabled={busy}
              onClick={() => void signInWith("discord")}
            >
              {busyAction === "discord" ? (
                <ButtonLoader label="Connecting to Discord" />
              ) : (
                <>
                  <img
                    src="/icons/discord.svg"
                    alt=""
                    aria-hidden="true"
                    className="h-4.5 w-5.75 brightness-0 invert"
                  />
                  Continue with Discord
                </>
              )}
            </button>
            <button
              type="button"
              data-ui="social-button github"
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-solid border-[#d9dbcf] bg-transparent text-[14px] font-semibold transition-[background,border-color] hover:border-[#b7c0a7] hover:bg-[#eeefe7] max-[580px]:min-h-12 max-[580px]:text-[13px]"
              disabled={busy}
              onClick={() => void signInWith("github")}
            >
              {busyAction === "github" ? (
                <ButtonLoader label="Connecting to GitHub" />
              ) : (
                <>
                  <img
                    src="/icons/github.svg"
                    alt=""
                    aria-hidden="true"
                    className="size-5"
                  />
                  Continue with GitHub
                </>
              )}
            </button>
          </div>

          {socialNotice && (
            <p
              data-ui="social-notice"
              className="flex items-start gap-2 rounded-md text-[#727d60] bg-[#eaf0df] p-2.5 text-[11px] leading-[1.6] mt-3 mb-0 [&_svg]:shrink-0 [&_svg]:mt-px"
              role="status"
            >
              <Icon icon={AlertCircleIcon} size={17} />
              {socialNotice === "google"
                ? "Google"
                : socialNotice === "discord"
                  ? "Discord"
                  : "GitHub"}
              {" sign-in is not configured on this server yet."}
            </p>
          )}

          <div
            data-ui="auth-divider"
            className="flex items-center gap-4 my-5.75 mx-0 text-[#76806a] text-[10px] before:[content:''] before:flex-1 before:h-px before:bg-[#e1e3d8] after:[content:''] after:flex-1 after:h-px after:bg-[#e1e3d8] max-[580px]:text-[10px] max-[580px]:my-5.5"
          >
            <span>or with email and password</span>
          </div>

          <form
            onSubmit={submit}
            noValidate
            data-ui="auth-form"
            className="flex flex-col gap-4.5"
          >
            {serverError && (
              <p
                data-ui="field-error"
                className="text-[12px] text-[#b04830] bg-[#fdf2ef] border border-solid border-[#f4c2b5] p-2.5 rounded-md leading-normal"
                role="alert"
              >
                {serverError}
              </p>
            )}

            {resetSent && (
              <p
                data-ui="field-success"
                className="text-[12px] text-[#3b6d22] bg-[#edf6e8] border border-solid border-[#bfe2b4] p-2.5 rounded-md leading-normal"
                role="status"
              >
                Password reset link sent! Check your inbox to set a new password.
              </p>
            )}

            {signup && (
              <div
                data-ui="form-field"
                className="flex flex-col [&_label]:block [&_label]:text-[14px] [&_label]:font-semibold [&_label]:mb-2 [&_input]:w-full [&_input]:border [&_input]:border-solid [&_input]:border-[#dcded2] [&_input]:bg-[#fcfcf8] [&_input]:h-11.75 [&_input]:py-0 [&_input]:px-3.25 [&_input]:rounded-md [&_input]:text-[#424938] [&_input]:text-[14px] [&_input]:[outline:none] [&_input]:[transition:border-color_0.15s,box-shadow_0.15s] [&_input::placeholder]:text-[#818974] [&_input:focus]:border-[#e58965] [&_input:focus]:shadow-[0_0_0_3px_#f45e3810] [&_input[aria-invalid='true']]:border-[#cc5d48] [&_input[aria-invalid='true']]:bg-[#fff8f2] max-[580px]:[&_label]:text-[13px] max-[580px]:[&_input]:text-[16px] max-[580px]:[&_input]:h-12 max-[580px]:[&_input]:px-3 max-[580px]:[&_input::placeholder]:text-[12px]"
              >
                <label htmlFor={`${id}-name`}>Your name (optional)</label>
                <input
                  id={`${id}-name`}
                  name="name"
                  type="text"
                  autoComplete="name"
                  placeholder="Alex Rivers"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    clearError("name");
                  }}
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? `${id}-name-error` : undefined}
                />
                {errors.name && (
                  <span
                    id={`${id}-name-error`}
                    data-ui="field-error"
                    className="mt-1.5 text-[11px] text-[#b04830] leading-normal"
                  >
                    {errors.name}
                  </span>
                )}
              </div>
            )}

            <div
              data-ui="form-field"
              className="flex flex-col [&_label]:block [&_label]:text-[14px] [&_label]:font-semibold [&_label]:mb-2 [&_input]:w-full [&_input]:border [&_input]:border-solid [&_input]:border-[#dcded2] [&_input]:bg-[#fcfcf8] [&_input]:h-11.75 [&_input]:py-0 [&_input]:px-3.25 [&_input]:rounded-md [&_input]:text-[#424938] [&_input]:text-[14px] [&_input]:[outline:none] [&_input]:[transition:border-color_0.15s,box-shadow_0.15s] [&_input::placeholder]:text-[#818974] [&_input:focus]:border-[#e58965] [&_input:focus]:shadow-[0_0_0_3px_#f45e3810] [&_input[aria-invalid='true']]:border-[#cc5d48] [&_input[aria-invalid='true']]:bg-[#fff8f2] max-[580px]:[&_label]:text-[13px] max-[580px]:[&_input]:text-[16px] max-[580px]:[&_input]:h-12 max-[580px]:[&_input]:px-3 max-[580px]:[&_input::placeholder]:text-[12px]"
            >
              <label htmlFor={`${id}-email`}>Email address</label>
              <input
                ref={emailRef}
                id={`${id}-email`}
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@somewhere.nice"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  clearError("email");
                }}
                aria-invalid={!!errors.email}
                aria-describedby={
                  errors.email ? `${id}-email-error` : undefined
                }
                required
              />
              {errors.email && (
                <span
                  id={`${id}-email-error`}
                  data-ui="field-error"
                  className="mt-1.5 text-[11px] text-[#b04830] leading-normal"
                >
                  {errors.email}
                </span>
              )}
            </div>

            <div
              data-ui="form-field"
              className="flex flex-col [&_label]:block [&_label]:text-[14px] [&_label]:font-semibold [&_label]:mb-2 [&_input]:w-full [&_input]:border [&_input]:border-solid [&_input]:border-[#dcded2] [&_input]:bg-[#fcfcf8] [&_input]:h-11.75 [&_input]:py-0 [&_input]:px-3.25 [&_input]:rounded-md [&_input]:text-[#424938] [&_input]:text-[14px] [&_input]:[outline:none] [&_input]:[transition:border-color_0.15s,box-shadow_0.15s] [&_input::placeholder]:text-[#818974] [&_input:focus]:border-[#e58965] [&_input:focus]:shadow-[0_0_0_3px_#f45e3810] [&_input[aria-invalid='true']]:border-[#cc5d48] [&_input[aria-invalid='true']]:bg-[#fff8f2] max-[580px]:[&_label]:text-[13px] max-[580px]:[&_input]:text-[16px] max-[580px]:[&_input]:h-12 max-[580px]:[&_input]:px-3 max-[580px]:[&_input::placeholder]:text-[12px]"
            >
              <div className="flex items-center justify-between mb-2">
                <label htmlFor={`${id}-password`} className="!mb-0">
                  Password
                </label>
                {!signup && (
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={busy}
                    className="text-[12px] text-[#8e452a] hover:text-[#d1522b] font-medium bg-transparent border-none p-0 cursor-pointer"
                  >
                    {busyAction === "reset" ? "Sending..." : "Forgot password?"}
                  </button>
                )}
              </div>
              <div className="relative flex items-center">
                <input
                  ref={passwordRef}
                  id={`${id}-password`}
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={signup ? "new-password" : "current-password"}
                  placeholder={signup ? "At least 6 characters" : "••••••••"}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    clearError("password");
                  }}
                  aria-invalid={!!errors.password}
                  aria-describedby={
                    errors.password ? `${id}-password-error` : undefined
                  }
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 text-[12px] font-semibold text-[#818974] hover:text-[#424938] bg-transparent border-none cursor-pointer p-1"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              {errors.password && (
                <span
                  id={`${id}-password-error`}
                  data-ui="field-error"
                  className="mt-1.5 text-[11px] text-[#b04830] leading-normal"
                >
                  {errors.password}
                </span>
              )}
            </div>

            <button
              data-ui="button button-orange auth-submit"
              className="inline-flex items-center gap-3 border border-solid border-transparent py-3.5 pr-5.5 pl-5.5 font-semibold rounded-[7px] [transition:background_0.2s,transform_0.2s,box-shadow_0.2s] whitespace-nowrap bg-orange text-[#3e2118] shadow-[0_2px_0_#d842201c] w-full justify-between mt-1 min-h-12 text-[14px] px-4.25 hover:transform-[translateY(-2px)] hover:bg-[#ed724d] hover:shadow-[0_5px_12px_#ee58202a] active:transform-[translateY(0)] max-[580px]:text-[13px] max-[580px]:min-h-12.25 motion-reduce:hover:transform-none"
              type="submit"
              disabled={busy}
            >
              {busyAction === "submit" ? (
                <ButtonLoader
                  label={signup ? "Creating your account" : "Signing you in"}
                />
              ) : (
                <>
                  {content.submit}
                  <Icon icon={ArrowRight01Icon} size={19} />
                </>
              )}
            </button>

            {signup && (
              <p className="m-0 text-center text-[10px] leading-5 text-[#7b806f] [&_a]:font-semibold [&_a]:text-[#596148] [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-[#c84b2b] max-[580px]:text-[10px]">
                By creating an account, you agree to the <Link to="/terms">Terms</Link>
                {" and "}
                <Link to="/privacy">Privacy Policy</Link>.
              </p>
            )}
          </form>

          <div
            data-ui="auth-invite"
            className="mt-6.5 [border-top-width:1px] [border-top-style:solid] border-t-[#e2e5d8] pt-5.75 text-center text-[11px] text-[#6d795e] [&_a]:inline-flex [&_a]:items-center [&_a]:gap-0.5 [&_a]:ml-1 [&_a]:text-[#626f4e] [&_a]:font-semibold [&_a:hover]:text-[#d1522b] max-[800px]:text-[10px] max-[580px]:text-[12px] max-[580px]:pt-5.75"
          >
            {signup
              ? "Already found your people?"
              : "Don’t have an account yet?"}{" "}
            <Link to={signup ? "/sign-in" : "/sign-up"}>
              {signup ? "Log in" : "Come on in"}{" "}
              <Icon icon={ArrowUpRight01Icon} size={15} />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

