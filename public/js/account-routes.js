// Route handlers for signing in and the account pages: login, signup, password
// reset, the account page, and the site admin page (docs/adr/0007, 0014).
import * as admin from "./admin.js";
import * as auth from "./auth.js";
import { show } from "./shell.js";
import { safeNextPath } from "./util.js";
import * as views from "./views.js";

const nextFrom = (search) => safeNextPath(new URLSearchParams(search).get("next"));

export function showSignIn({ match, search, user, state, router, announce, initial }) {
  const next = nextFrom(search);
  if (user) return router.go(next, { replace: true, initial });
  const intro = next.startsWith("/join/") ? "Sign in or create an account to join the campaign." : undefined;
  if (match.name === "signup") {
    return show(
      views.signupView({
        next,
        intro,
        onSubmit: async (details) => {
          const result = await auth.signUp({ ...details, next });
          if (result.signedIn) router.go(next, { replace: true });
          return result;
        },
      }),
      "Create an account",
      announce,
    );
  }
  const authNotice = state.authNotice;
  state.authNotice = null;
  return show(
    views.loginView({
      intro,
      authNotice,
      next,
      onPassword: async (email, password) => {
        await auth.signInWithPassword(email, password);
        router.go(next, { replace: true });
      },
      onMagicLink: (email) => auth.sendMagicLink(email, next),
    }),
    "Sign in",
    announce,
  );
}

export function showForgotPassword({ announce }) {
  show(views.forgotPasswordView({ onSubmit: auth.sendPasswordReset }), "Reset your password", announce);
}

// The emailed link signs the person in. No session means the link was bad.
export async function showResetPassword({ user, state, router, ensureAccount, announce }) {
  if (!user) return show(views.linkExpiredView(), "Link expired", announce);
  await ensureAccount(user);
  return show(
    views.resetPasswordView({
      email: user.email,
      displayName: state.profile.display_name,
      onSubmit: async (password) => {
        await auth.updatePassword(password);
        await auth.signOut("others");
        router.go("/", { replace: true });
      },
    }),
    "New password",
    announce,
  );
}

export function showAccount({ state, user, router, updateAccount, announce }) {
  return show(
    views.accountView({
      profile: state.profile,
      email: user.email,
      onRename: async (name) => {
        await auth.updateDisplayName(user.id, name);
        state.profile = { ...state.profile, display_name: name };
        updateAccount();
      },
      onChangeEmail: auth.updateEmail,
      onChangePassword: auth.updatePassword,
      onReauthenticate: auth.requestReauthentication,
      onSignOutOthers: () => auth.signOut("others"),
      onSignOutEverywhere: async () => {
        await auth.signOut("global");
        router.go("/login", { replace: true });
      },
    }),
    "Your account",
    announce,
  );
}

// To anyone else the page does not exist. The database refuses them anyway.
export function showAdmin({ announce }) {
  return show(
    views.adminView({
      loadAccounts: admin.listAccounts,
      loadPending: admin.listPendingApprovals,
      approveEmail: admin.approveEmail,
      revokeApproval: admin.revokeApproval,
      loadPurges: admin.listPurges,
      onCopy: (text) => navigator.clipboard.writeText(text),
    }),
    "Site admin",
    announce,
  );
}
