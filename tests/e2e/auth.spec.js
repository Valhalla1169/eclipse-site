import { GOOD_PASSWORD, callsTo, clearCalls, expect, open, patchMock, players, seed, storedSession, test } from "./helpers.js";

const dana = players.dana;
const submit = (page, name) => page.getByRole("button", { name, exact: true }).click();

test.describe("signed out", () => {
  test("home sends you to sign in, and account keeps its place", async ({ page }) => {
    await seed(page);
    await open(page, "/");
    await expect(page).toHaveURL(/\/login$/);
    await open(page, "/account");
    await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);
    await expect(page.locator("#account")).toBeHidden();
  });

  test("first render leaves focus alone; later navigation moves it to the heading", async ({ page }) => {
    await seed(page);
    await open(page, "/login");
    await expect(page.locator("h1")).not.toBeFocused();
    await page.getByRole("link", { name: "Forgot your password?" }).click();
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeFocused();
  });

  test("an unknown path shows Not found", async ({ page }) => {
    await seed(page);
    await open(page, "/nothing/here");
    await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
  });

  test("an expired emailed link explains itself on the sign-in page and cleans the URL", async ({ page }) => {
    await seed(page);
    await open(page, "/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("alert")).toContainText("That link has expired. Ask for a new one.");
  });
});

test.describe("sign in", () => {
  test("password sign-in goes home and never stores the password", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile } });
    await open(page, "/login");
    await page.locator("#email").fill("  Dana@Example.COM ");
    await page.locator("#password").fill(GOOD_PASSWORD);
    await submit(page, "Sign in");
    await expect(page.getByRole("heading", { name: "Welcome, Dana Voss" })).toBeVisible();
    await expect(page.locator("#account-name")).toHaveText("Dana Voss");

    const [call] = await callsTo(page, "/auth/v1/token", "POST");
    expect(call.query).toContain("grant_type=password");
    expect(call.body.email).toBe("dana@example.com");

    const stored = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => !k.startsWith("__")).map((k) => localStorage.getItem(k)).join("\n") +
      Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k)).join("\n"),
    );
    expect(stored).not.toContain(GOOD_PASSWORD);
  });

  test("a wrong password shows one generic message and stays on the page", async ({ page }) => {
    await seed(page, { mock: { loginError: true } });
    await open(page, "/login");
    await page.locator("#email").fill("dana@example.com");
    await page.locator("#password").fill("not the right one");
    await submit(page, "Sign in");
    await expect(page.getByRole("alert")).toHaveText("Error: Email or password is wrong.");
    await expect(page).toHaveURL(/\/login$/);
    expect(await storedSession(page)).toBeNull();
  });

  test("empty and malformed input is refused before any request", async ({ page }) => {
    await seed(page);
    await open(page, "/login");
    await page.locator("#email").fill("not-an-email");
    await page.locator("#password").fill("x");
    await submit(page, "Sign in");
    await expect(page.getByRole("alert")).toContainText("Enter a valid email address.");
    await page.locator("#email").fill("dana@example.com");
    await page.locator("#password").fill("");
    await submit(page, "Sign in");
    await expect(page.getByRole("alert")).toContainText("Enter your password.");
    expect(await callsTo(page, "/auth/v1/token")).toHaveLength(0);
  });

  test("the show-password button toggles the field", async ({ page }) => {
    await seed(page);
    await open(page, "/login");
    const field = page.locator("#password");
    const toggle = page.getByRole("button", { name: "Show password" });
    await expect(field).toHaveAttribute("type", "password");
    await toggle.click();
    await expect(field).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  });

  test("after sign-in you return to the page you wanted", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile } });
    await open(page, "/login?next=%2Faccount");
    await page.locator("#email").fill("dana@example.com");
    await page.locator("#password").fill(GOOD_PASSWORD);
    await submit(page, "Sign in");
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("heading", { name: "Your account", exact: true })).toBeVisible();
  });

  for (const next of ["//evil.example", "https://evil.example", "javascript:alert(1)", "/\\evil.example"]) {
    test(`a crafted next=${next} cannot send you off the site`, async ({ page }) => {
      await seed(page, { mock: { profile: dana.profile }, user: dana });
      await open(page, `/login?next=${encodeURIComponent(next)}`);
      await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
    });
  }

  test("an email link request says the same thing for any address", async ({ page }) => {
    await seed(page);
    await open(page, "/login");
    await page.locator("#linkEmail").fill("Someone@Example.com");
    await submit(page, "Email me a sign-in link");
    await expect(page.getByRole("status").filter({ hasText: "If someone@example.com can sign in here" })).toBeVisible();
    const [call] = await callsTo(page, "/auth/v1/otp");
    expect(call.query).toContain("redirect_to");
    expect(call.body.code_challenge).toBeTruthy();
  });

  test("the email link form reports a rate limit in plain words", async ({ page }) => {
    await seed(page, { mock: { otpError: { status: 429, error_code: "over_email_send_rate_limit", msg: "rate" } } });
    await open(page, "/login");
    await page.locator("#linkEmail").fill("dana@example.com");
    await submit(page, "Email me a sign-in link");
    await expect(page.getByRole("alert")).toContainText("Too many emails were sent.");
  });

  test("a signed-in person is sent past the sign-in page", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile }, user: dana });
    await open(page, "/login");
    await expect(page.getByRole("heading", { name: "Welcome, Dana Voss" })).toBeVisible();
  });
});

test.describe("sign up", () => {
  const fill = async (page, { name = "Dana Voss", email = "dana@example.com", password = GOOD_PASSWORD } = {}) => {
    await page.locator("#displayName").fill(name);
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await submit(page, "Create account");
  };

  test("creates an account and asks for email confirmation", async ({ page }) => {
    await seed(page);
    await open(page, "/signup");
    await fill(page, { name: "  Dana   Voss ", email: "Dana@Example.com" });
    await expect(page.getByRole("status").filter({ hasText: "Check your email." })).toContainText("dana@example.com");
    const [call] = await callsTo(page, "/auth/v1/signup");
    expect(call.body.email).toBe("dana@example.com");
    expect(call.body.data).toEqual({ display_name: "Dana Voss" });
    expect(call.query).toContain("redirect_to");
    expect(await storedSession(page)).toBeNull();
  });

  const refusals = [
    ["a short password", { password: "short one" }, "Use at least 12 characters."],
    ["a password with the name in it", { password: "dana is my password" }, "Do not put your name or email in your password."],
    ["a password over 72 bytes", { password: "correct horse battery staple ".repeat(3) }, "Use at most 72 bytes."],
    ["a blank name", { name: "   " }, "Enter a name between 1 and 40 characters."],
    ["a bad email", { email: "nope" }, "Enter a valid email address."],
  ];
  for (const [label, input, message] of refusals) {
    test(`refuses ${label} before any request`, async ({ page }) => {
      await seed(page);
      await open(page, "/signup");
      await fill(page, input);
      await expect(page.getByRole("alert")).toContainText(message);
      expect(await callsTo(page, "/auth/v1/signup")).toHaveLength(0);
    });
  }

  test("a server refusal is shown in plain words", async ({ page }) => {
    await seed(page, { mock: { signupError: "user_already_exists" } });
    await open(page, "/signup");
    await fill(page);
    await expect(page.getByRole("alert")).toContainText("We could not create that account. Try signing in instead.");
  });

  test("the sign-up link keeps the invite you were opening", async ({ page }) => {
    await seed(page);
    await open(page, "/join/ABCDEF0123");
    await expect(page).toHaveURL(/\/login\?next=%2Fjoin%2FABCDEF0123$/);
    await expect(page.getByText("Sign in or create an account to join the campaign.")).toBeVisible();
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/signup\?next=%2Fjoin%2FABCDEF0123$/);
  });
});

test.describe("forgot and reset password", () => {
  test("asking for a reset says the same thing for any address", async ({ page }) => {
    await seed(page);
    await open(page, "/forgot-password");
    await page.locator("#email").fill("Nobody@Example.com");
    await submit(page, "Email me a reset link");
    await expect(page.getByRole("status").filter({ hasText: "If an account uses nobody@example.com" })).toBeVisible();
    const [call] = await callsTo(page, "/auth/v1/recover");
    expect(decodeURIComponent(call.query)).toContain("/reset-password");
  });

  test("a reset rate limit is shown in plain words", async ({ page }) => {
    await seed(page, { mock: { recoverError: true } });
    await open(page, "/forgot-password");
    await page.locator("#email").fill("dana@example.com");
    await submit(page, "Email me a reset link");
    await expect(page.getByRole("alert")).toContainText("Too many emails were sent.");
  });

  test("the reset page without a session says the link does not work", async ({ page }) => {
    await seed(page);
    await open(page, "/reset-password");
    await expect(page.getByRole("heading", { name: "This link does not work" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Get a new link" })).toHaveAttribute("href", "/forgot-password");
  });

  test("choosing a new password signs out the other devices and goes home", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile }, user: dana });
    await open(page, "/reset-password");
    await page.locator("#password").fill("short");
    await submit(page, "Save new password");
    await expect(page.getByRole("alert")).toContainText("Use at least 12 characters.");

    await page.locator("#password").fill(GOOD_PASSWORD);
    await submit(page, "Save new password");
    await expect(page).toHaveURL(/\/$/);
    const [update] = await callsTo(page, "/auth/v1/user", "PUT");
    expect(update.body.password).toBe(GOOD_PASSWORD);
    const [logout] = await callsTo(page, "/auth/v1/logout");
    expect(logout.query).toContain("scope=others");
  });
});

test.describe("account page", () => {
  test.beforeEach(async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile }, user: dana });
    await open(page, "/account");
  });

  test("shows the email and lets you rename yourself", async ({ page }) => {
    await expect(page.getByText("Signed in as")).toContainText("dana@example.com");
    await page.locator("#displayName").fill("  Dana   V ");
    await submit(page, "Save name");
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    await expect(page.locator("#account-name")).toHaveText("Dana V");
    const [patch] = await callsTo(page, "/rest/v1/profiles", "PATCH");
    expect(patch.body).toEqual({ display_name: "Dana V" });
  });

  test("refuses a blank name", async ({ page }) => {
    await page.locator("#displayName").fill("   ");
    await submit(page, "Save name");
    await expect(page.getByRole("alert")).toContainText("Enter a name between 1 and 40 characters.");
    expect(await callsTo(page, "/rest/v1/profiles", "PATCH")).toHaveLength(0);
  });

  test("changing email asks both addresses to confirm", async ({ page }) => {
    await page.locator("#newEmail").fill("New@Example.com");
    await submit(page, "Change email");
    await expect(page.getByRole("status").filter({ hasText: "both addresses" })).toBeVisible();
    const [call] = await callsTo(page, "/auth/v1/user", "PUT");
    expect(call.body.email).toBe("new@example.com");
    await expect(page.getByText("Signed in as")).toContainText("dana@example.com");
  });

  test("changing password works right away when Auth does not need a code", async ({ page }) => {
    await page.locator("#newPassword").fill(GOOD_PASSWORD);
    await submit(page, "Change password");
    await expect(page.getByRole("status").filter({ hasText: "Your password is changed." })).toBeVisible();
    await expect(page.locator("#nonce")).toBeHidden();
  });

  test("changing password asks for the emailed code when Auth requires one", async ({ page }) => {
    await patchMock(page, { reauthRequired: true });
    await page.locator("#newPassword").fill(GOOD_PASSWORD);
    await submit(page, "Change password");
    await expect(page.getByRole("alert")).toContainText("we emailed you a code");
    await expect(page.locator("#nonce")).toBeVisible();
    expect(await callsTo(page, "/auth/v1/reauthenticate")).toHaveLength(1);

    await page.locator("#nonce").fill(" 123456 ");
    await submit(page, "Change password");
    await expect(page.getByRole("status").filter({ hasText: "Your password is changed." })).toBeVisible();
    const puts = await callsTo(page, "/auth/v1/user", "PUT");
    expect(puts.at(-1).body).toMatchObject({ password: GOOD_PASSWORD, nonce: "123456" });
    await expect(page.locator("#nonce")).toBeHidden();
  });

  test("a new password equal to the old one is refused in plain words", async ({ page }) => {
    await patchMock(page, { samePassword: true });
    await page.locator("#newPassword").fill(GOOD_PASSWORD);
    await submit(page, "Change password");
    await expect(page.getByRole("alert")).toContainText("must be different");
  });

  test("a weak new password never reaches the server", async ({ page }) => {
    await clearCalls(page);
    await page.locator("#newPassword").fill("weak");
    await submit(page, "Change password");
    await expect(page.getByRole("alert")).toContainText("Use at least 12 characters.");
    expect(await callsTo(page, "/auth/v1/user", "PUT")).toHaveLength(0);
  });

  test("sign out my other devices keeps this session", async ({ page }) => {
    await page.getByRole("button", { name: "Sign out my other devices" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Your other devices are signed out." })).toBeVisible();
    const [call] = await callsTo(page, "/auth/v1/logout");
    expect(call.query).toContain("scope=others");
    await expect(page).toHaveURL(/\/account$/);
    expect(await storedSession(page)).not.toBeNull();
  });

  test("sign out everywhere ends this session too", async ({ page }) => {
    await page.getByRole("button", { name: "Sign out everywhere" }).click();
    await expect(page).toHaveURL(/\/login$/);
    const [call] = await callsTo(page, "/auth/v1/logout");
    expect(call.query).toContain("scope=global");
    expect(await storedSession(page)).toBeNull();
  });

  test("says deletion is done by the site owner", async ({ page }) => {
    await expect(page.getByText("accounts are deleted by the site owner")).toBeVisible();
  });
});

test("the header Sign out button ends this browser's session only", async ({ page }) => {
  await seed(page, { mock: { profile: dana.profile }, user: dana });
  await open(page, "/");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("#account")).toBeHidden();
  const [call] = await callsTo(page, "/auth/v1/logout");
  expect(call.query).toContain("scope=local");
  expect(await storedSession(page)).toBeNull();
});
