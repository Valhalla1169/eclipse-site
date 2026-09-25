// A small in-memory stand-in for the Supabase Auth and REST APIs, injected into every
// page by Playwright (addInitScript) before the app loads. The app code is untouched
// and the real CSP still applies, because this script is not part of the page.
//
// It replaces fetch() for the project's origin only. State lives in localStorage so it
// survives navigations: `__mock` is the scenario a test sets, `__calls` records every
// request, and `__viol` records CSP violations.
(function () {
  var ORIGIN = "https://eosnplpgzqahwgaytauu.supabase.co";
  var PLAYER = "00000000-0000-4000-8000-0000000000a1";
  var realFetch = window.fetch.bind(window);

  function config() {
    try { return JSON.parse(localStorage.getItem("__mock") || "{}"); } catch (e) { return {}; }
  }
  function save(c) { localStorage.setItem("__mock", JSON.stringify(c)); }
  function record(entry) {
    var calls = JSON.parse(localStorage.getItem("__calls") || "[]");
    calls.push(entry);
    localStorage.setItem("__calls", JSON.stringify(calls));
  }
  function json(status, body) {
    return new Response(JSON.stringify(body), { status: status, headers: { "Content-Type": "application/json" } });
  }
  function authError(status, code, message) {
    return json(status, { code: status, error_code: code, msg: message });
  }
  function userObject(id, email) {
    return { id: id, aud: "authenticated", role: "authenticated", email: email, app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  }
  function sessionObject(id, email) {
    return { access_token: "fake." + btoa(JSON.stringify({ sub: id })).replace(/=/g, "") + ".sig", refresh_token: "fake-refresh", token_type: "bearer",
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 86400 * 30, user: userObject(id, email) };
  }

  // The characters table, the way the real one behaves for a row's owner: writes go
  // through only for the columns a client may write (ADR 0006), an update matches only
  // while updated_at is still what the client saw (and never for a deleted character),
  // every accepted update gets a new updated_at, and a person can have 5 characters
  // that are not deleted (ADR 0014). `c.characters` holds the rows. `c.characterBlocked`
  // makes updates match nothing, `c.failPatches` fails that many updates with a network
  // error first, and `c.failCharacters` fails every call.
  var WRITABLE = ["owner_id", "character_name", "data", "schema_version"];
  var UPDATABLE = ["character_name", "data", "schema_version"];
  var MAX_LIVE = 5;
  var FULL = "you already have 5 characters, the most one person can have";
  var MAX_DATA_BYTES = 524288;
  function stamp(c) {
    c.clock = (c.clock || 0) + 1;
    return new Date(Date.UTC(2026, 8, 19, 12, 0, c.clock)).toISOString().replace("Z", "456+00:00");
  }
  function pgError(message, code) { return json(400, { code: code || "P0001", message: message, details: null, hint: null }); }
  function projector(u) {
    var select = (u.searchParams.get("select") || "").split(",").map(function (x) { return x.trim(); });
    return function (r) {
      var out = {};
      select.forEach(function (k) { out[k] = r[k]; });
      return out;
    };
  }
  function idList(value) { return value && value.indexOf("in.(") === 0 ? value.slice(4, -1).split(",") : null; }
  function matches(u, r, names) {
    return names.every(function (name) {
      var wanted = u.searchParams.get(name);
      if (!wanted) return true;
      var list = idList(wanted);
      return list ? list.indexOf(String(r[name])) !== -1 : "eq." + r[name] === wanted;
    });
  }
  function characters(c, u, method, body) {
    if (c.failCharacters) throw new TypeError("Failed to fetch");
    var all = c.characters || [];
    var project = projector(u);
    if (method === "GET") {
      var found = all.filter(function (r) { return matches(u, r, ["id", "owner_id"]); });
      if ((u.searchParams.get("order") || "").indexOf("updated_at.desc") === 0) found.sort(function (a, b) { return b.updated_at.localeCompare(a.updated_at); });
      return json(200, found.map(project));
    }
    if (method === "POST") {
      var bad = Object.keys(body).filter(function (k) { return WRITABLE.indexOf(k) === -1; });
      if (bad.length) return pgError("permission denied for column " + bad[0], "42501");
      var live = all.filter(function (r) { return r.owner_id === body.owner_id && !r.deleted_at; }).length;
      if (live >= MAX_LIVE) return pgError(FULL);
      c.made = (c.made || 0) + 1;
      var row = { id: "40000000-0000-4000-8000-" + String(900000 + c.made).padStart(12, "0"), owner_id: body.owner_id, schema_version: body.schema_version, character_name: body.character_name, data: body.data, updated_at: stamp(c), deleted_at: null };
      all.push(row);
      c.characters = all; save(c);
      return json(201, [project(row)]);
    }
    if (method === "PATCH") {
      var forbidden = Object.keys(body).filter(function (k) { return UPDATABLE.indexOf(k) === -1; });
      if (forbidden.length) return pgError("permission denied for column " + forbidden[0], "42501");
      if (c.failPatches > 0) { c.failPatches -= 1; save(c); throw new TypeError("Failed to fetch"); }
      if (JSON.stringify(body.data || {}).length > MAX_DATA_BYTES) return pgError("new row violates check constraint \"characters_data_size\"", "23514");
      var target = all.filter(function (r) { return "eq." + r.id === u.searchParams.get("id"); })[0];
      if (target && body.schema_version < target.schema_version) return pgError("schema_version can only increase");
      var ok = target && !c.characterBlocked && !target.deleted_at && "eq." + target.updated_at === u.searchParams.get("updated_at");
      if (!ok) return json(200, []);
      Object.keys(body).forEach(function (k) { target[k] = body[k]; });
      target.updated_at = stamp(c);
      save(c);
      return json(200, [{ updated_at: target.updated_at }]);
    }
    return json(405, { message: "fake-supabase: unhandled " + method + " /rest/v1/characters" });
  }

  // Which character is active in which campaign, the copies kept from players who left,
  // and the functions that change them (migration 0009). `c.assignments` holds
  // { campaign_id, player_id, character_id }, `c.departed` the copies.
  function assignments(c, u) {
    var project = projector(u);
    return json(200, (c.assignments || []).filter(function (r) { return matches(u, r, ["campaign_id", "player_id", "character_id"]); }).map(project));
  }
  function departed(c, u) {
    var project = projector(u);
    return json(200, (c.departed || []).filter(function (r) { return matches(u, r, ["campaign_id", "id"]); }).map(project));
  }
  function characterById(c, id) { return (c.characters || []).filter(function (r) { return r.id === id; })[0]; }
  function chooseCharacter(c, body) {
    var row = characterById(c, body.p_character_id);
    if (!row || row.deleted_at) return pgError("that character was not found");
    var list = c.assignments || [];
    if (list.some(function (a) { return a.character_id === row.id && a.campaign_id !== body.p_campaign_id; })) {
      return pgError("that character is already active in another campaign. Choose a different character there first");
    }
    list = list.filter(function (a) { return !(a.campaign_id === body.p_campaign_id && a.player_id === row.owner_id); });
    list.push({ campaign_id: body.p_campaign_id, player_id: row.owner_id, character_id: row.id, assigned_at: new Date().toISOString() });
    c.assignments = list; save(c);
    return new Response(null, { status: 204 });
  }
  function deleteCharacter(c, body) {
    var row = characterById(c, body.p_character_id);
    if (!row) return pgError("that character was not found");
    if ((c.assignments || []).some(function (a) { return a.character_id === row.id; })) return pgError("that character is active in a campaign. Choose a different character there first");
    row.deleted_at = new Date().toISOString(); row.updated_at = stamp(c); save(c);
    return new Response(null, { status: 204 });
  }
  function undeleteCharacter(c, body) {
    var row = characterById(c, body.p_character_id);
    if (!row) return pgError("that character was not found");
    var live = (c.characters || []).filter(function (r) { return r.owner_id === row.owner_id && !r.deleted_at; }).length;
    if (live >= MAX_LIVE) return pgError(FULL);
    row.deleted_at = null; row.updated_at = stamp(c); save(c);
    return new Response(null, { status: 204 });
  }

  // Realtime: a stand-in for the Phoenix websocket, so no network is opened. Tests
  // call window.__realtime.emit() (a sheet changed) and .drop() (the connection ends).
  // Only the messages the app needs: join, heartbeat and leave.
  var RealWebSocket = window.WebSocket;
  var sockets = [];
  var joins = [];
  function FakeSocket(url) {
    var self = new EventTarget();
    self.url = url; self.readyState = 0; self.binaryType = "blob"; self.bufferedAmount = 0; self.protocol = ""; self.extensions = ""; self.topics = {};
    function fire(type, event) { if (typeof self["on" + type] === "function") self["on" + type](event); self.dispatchEvent(event); }
    function reply(joinRef, ref, topic, response) { fire("message", new MessageEvent("message", { data: JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: response }]) })); }
    self.send = function (text) {
      var msg; try { msg = JSON.parse(text); } catch (e) { return; }
      var joinRef = msg[0], ref = msg[1], topic = msg[2], event = msg[3], payload = msg[4];
      if (event === "phx_join") {
        var changes = ((payload || {}).config || {}).postgres_changes || [];
        self.topics[topic] = { joinRef: joinRef, ids: changes.map(function (x, i) { return i + 1; }) };
        joins.push(changes);
        reply(joinRef, ref, topic, { postgres_changes: changes.map(function (x, i) { return Object.assign({ id: i + 1 }, x); }) });
      } else if (event === "heartbeat") reply(null, ref, "phoenix", {});
      else reply(joinRef, ref, topic, {});
    };
    self.close = function (code, reason) {
      if (self.readyState === 3) return;
      self.readyState = 3;
      fire("close", new CloseEvent("close", { code: code || 1000, reason: reason || "" }));
    };
    self.emit = function () {
      Object.keys(self.topics).forEach(function (topic) {
        var t = self.topics[topic];
        fire("message", new MessageEvent("message", { data: JSON.stringify([t.joinRef, null, topic, "postgres_changes", { ids: t.ids, data: { schema: "public", table: "characters", commit_timestamp: new Date().toISOString(), type: "UPDATE", columns: [], record: {}, old_record: {}, errors: null } }]) }));
      });
    };
    sockets.push(self);
    setTimeout(function () { self.readyState = 1; fire("open", new Event("open")); }, 0);
    return self;
  }
  FakeSocket.CONNECTING = 0; FakeSocket.OPEN = 1; FakeSocket.CLOSING = 2; FakeSocket.CLOSED = 3;
  window.WebSocket = function (url, protocols) {
    return String(url).indexOf("wss://" + ORIGIN.slice(8) + "/realtime/") === 0 ? FakeSocket(url) : new RealWebSocket(url, protocols);
  };
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.__realtime = {
    joins: joins,
    emit: function () { sockets.forEach(function (x) { if (x.readyState === 1) x.emit(); }); },
    drop: function () { sockets.forEach(function (x) { x.close(1006, "test"); }); },
    open: function () { return sockets.filter(function (x) { return x.readyState === 1; }).length; },
  };

  // character_history, as its owner sees it, and the restore function (migration 0008).
  // `c.history` holds the snapshots.
  function history(c, u) {
    var select = (u.searchParams.get("select") || "").split(",").map(function (x) { return x.trim(); });
    var byCharacter = u.searchParams.get("character_id");
    var byId = u.searchParams.get("id");
    var rows = (c.history || []).filter(function (r) {
      return (!byCharacter || "eq." + r.character_id === byCharacter) && (!byId || "eq." + r.id === byId);
    });
    rows.sort(function (a, b) { return b.saved_at.localeCompare(a.saved_at) || b.id - a.id; });
    var limit = Number(u.searchParams.get("limit")) || rows.length;
    return json(200, rows.slice(0, limit).map(function (r) {
      var out = {}; select.forEach(function (k) { out[k] = r[k]; }); return out;
    }));
  }
  function restore(c, body) {
    var snap = (c.history || []).filter(function (r) { return r.id === body.p_history_id; })[0];
    if (!snap) return pgError("that version was not found");
    var row = characterById(c, snap.character_id);
    if (!row) return pgError("that version cannot be restored because its character no longer exists");
    if (row.deleted_at) return pgError("that character is deleted. Bring it back first");
    if (!body.p_expected || row.updated_at !== body.p_expected) return pgError("the sheet changed since you opened it");
    c.history.push({ id: c.history.reduce(function (m, r) { return Math.max(m, r.id); }, 0) + 1, character_id: row.id, schema_version: row.schema_version, character_name: row.character_name, data: row.data, reason: "restore", saved_at: new Date().toISOString() });
    row.data = snap.data; row.schema_version = snap.schema_version; row.character_name = snap.character_name;
    row.updated_at = stamp(c);
    save(c);
    return json(200, row.updated_at);
  }

  // Who may make an account, and the site admin's functions (migration 0011).
  // `c.admin` makes the signed-in person a site admin, and `c.adminCheckFails` makes
  // is_site_admin fail. `c.accounts` holds { user_id, email, display_name, created_at,
  // last_sign_in_at, email_confirmed_at, is_admin }, and `c.approvals` holds { email,
  // approved_at, expires_at, approved_by_name }. Supabase Auth runs the hook only for a
  // new email, and the hook refuses an email with no approval that has not expired. Only
  // a confirmed account uses an approval. The admin functions refuse a signed-out caller
  // (no execute grant) and anyone who is not an admin.
  var NOT_APPROVED = "this email is not approved to make an account";
  var MAX_WAITING = 20;
  var APPROVAL_MS = 7 * 86400 * 1000;
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var ADMIN_RPCS = { is_site_admin: "GET", list_accounts: "GET", list_pending_approvals: "GET", approve_email: "POST", revoke_approval: "POST" };
  function anyAccount(c, email) { return (c.accounts || []).some(function (a) { return a.email === email; }); }
  function confirmedAccount(c, email) { return (c.accounts || []).some(function (a) { return a.email === email && a.email_confirmed_at; }); }
  function current(approval) { return new Date(approval.expires_at) > new Date(); }
  function waiting(c) { return (c.approvals || []).filter(function (a) { return !confirmedAccount(c, a.email); }); }
  function mayMakeAccount(c, email) {
    var wanted = String(email || "").toLowerCase();
    return anyAccount(c, wanted) || (c.approvals || []).some(function (a) { return a.email === wanted && current(a); });
  }
  function signedIn(input, init) {
    var headers = new Headers((init && init.headers) || (input && input.headers) || {});
    return (headers.get("Authorization") || "").indexOf("Bearer fake.") === 0;
  }
  function adminOnly(c, action) { return c.admin ? null : pgError("only a site admin can " + action); }
  function approveEmail(c, body) {
    var email = String(body.p_email || "").trim().toLowerCase();
    if (email.length > 254 || !EMAIL.test(email)) return pgError("that is not an email address");
    if (confirmedAccount(c, email)) return json(200, [{ email: email, has_account: true, expires_at: null }]);
    var list = c.approvals || [];
    var existing = list.filter(function (a) { return a.email === email; })[0];
    if (!(existing && current(existing)) && waiting(c).filter(current).length >= MAX_WAITING) {
      return pgError("there are already 20 approved emails with no account. Revoke one first");
    }
    var now = Date.now();
    var approval = { email: email, approved_at: new Date(now).toISOString(), expires_at: new Date(now + APPROVAL_MS).toISOString(), approved_by_name: (c.profile || {}).display_name || null };
    c.approvals = list.filter(function (a) { return a.email !== email; }).concat([approval]); save(c);
    return json(200, [{ email: email, has_account: false, expires_at: approval.expires_at }]);
  }
  function revokeApproval(c, body) {
    var email = String(body.p_email || "").trim().toLowerCase();
    if (confirmedAccount(c, email)) return pgError("that email already has an account, so its approval cannot be revoked");
    var list = c.approvals || [];
    if (!list.some(function (a) { return a.email === email; })) return pgError("that email is not approved");
    c.approvals = list.filter(function (a) { return a.email !== email; }); save(c);
    return new Response(null, { status: 204 });
  }
  function adminRpc(c, name, body) {
    if (name === "is_site_admin") return c.adminCheckFails ? json(500, { code: "XX000", message: "fake-supabase: is_site_admin failed", details: null, hint: null }) : json(200, !!c.admin);
    if (name === "list_accounts") return adminOnly(c, "list the accounts") || json(200, c.accounts || []);
    if (name === "list_pending_approvals") return adminOnly(c, "list the approvals") || json(200, waiting(c));
    if (name === "approve_email") return adminOnly(c, "approve an email") || approveEmail(c, body);
    return adminOnly(c, "revoke an approval") || revokeApproval(c, body);
  }

  document.addEventListener("securitypolicyviolation", function (e) {
    var v = JSON.parse(localStorage.getItem("__viol") || "[]");
    v.push({ directive: e.violatedDirective, blocked: e.blockedURI, file: e.sourceFile || "", line: e.lineNumber });
    localStorage.setItem("__viol", JSON.stringify(v));
  }, true);

  window.fetch = async function (input, init) {
    var url = typeof input === "string" ? input : input.url;
    if (url.indexOf(ORIGIN) !== 0) return realFetch(input, init);
    var u = new URL(url);
    var method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    var body = null;
    try { body = init && init.body ? JSON.parse(init.body) : null; } catch (e) { body = String(init.body); }
    record({ method: method, path: u.pathname, query: u.search, body: body });

    // `c.hold` lists requests, such as "PATCH /rest/v1/characters", that wait until the
    // test takes them off the list.
    var held = method + " " + u.pathname;
    while ((config().hold || []).indexOf(held) !== -1) await new Promise(function (resolve) { setTimeout(resolve, 20); });

    var c = config();
    var select = u.searchParams.get("select") || "";
    var path = u.pathname;

    // ── Auth ──
    if (path === "/auth/v1/token" && u.searchParams.get("grant_type") === "password") {
      if (c.loginError) return authError(400, "invalid_credentials", "Invalid login credentials");
      var who = c.loginUser || { id: PLAYER, email: body.email };
      return json(200, sessionObject(who.id, who.email));
    }
    // Auth answers a refusal from the sign-up hook with the hook's status and message.
    if (path === "/auth/v1/signup") {
      if (c.signupError) return authError(422, c.signupError, "signup refused");
      if (!mayMakeAccount(c, body.email)) return json(403, { code: "unknown", message: NOT_APPROVED });
      return json(200, userObject("00000000-0000-4000-8000-0000000000f9", body.email));
    }
    if (path === "/auth/v1/otp") {
      if (c.otpError) return authError(c.otpError.status, c.otpError.error_code, c.otpError.msg);
      if (!mayMakeAccount(c, body.email)) return json(403, { code: "unknown", message: NOT_APPROVED });
      return json(200, {});
    }
    if (path === "/auth/v1/recover") return c.recoverError ? authError(429, "over_email_send_rate_limit", "rate limit") : json(200, {});
    if (path === "/auth/v1/reauthenticate") return json(200, {});
    if (path === "/auth/v1/logout") return new Response(null, { status: 204 });
    if (path === "/auth/v1/user" && method === "PUT") {
      if (body.password && c.reauthRequired && !body.nonce) return authError(400, "reauthentication_needed", "Password update requires reauthentication");
      if (body.password && c.samePassword) return authError(422, "same_password", "same");
      var current = userObject(PLAYER, c.sessionEmail || "dana@example.com");
      if (body.email) current.new_email = body.email;
      return json(200, current);
    }

    // ── REST ──
    if (path.indexOf("/rest/v1/") === 0 && c.failNetwork) throw new TypeError("Failed to fetch");

    if (path === "/rest/v1/campaign_players" && method === "GET") return json(200, c.members || []);

    if (path === "/rest/v1/profiles") {
      if (method === "GET" && (u.searchParams.get("id") || "").indexOf("in.(") === 0) {
        var wanted = u.searchParams.get("id").slice(4, -1).split(",");
        return json(200, (c.profiles || []).filter(function (p) { return wanted.indexOf(p.id) !== -1; }));
      }
      if (method === "GET") return json(200, c.profile ? [c.profile] : []);
      if (method === "POST") { c.profile = { id: body.id, display_name: body.display_name }; save(c); return json(201, [c.profile]); }
      if (method === "PATCH") { if (c.profile) c.profile.display_name = body.display_name; save(c); return new Response(null, { status: 204 }); }
    }

    if (path === "/rest/v1/campaign_creators") {
      var owner = (u.searchParams.get("user_id") || "").replace(/^eq\./, "");
      return json(200, c.creator ? [{ user_id: owner }] : []);
    }

    if (path === "/rest/v1/campaign_invites") {
      var cid = (u.searchParams.get("campaign_id") || "").replace(/^eq\./, "");
      return json(200, (c.invites || []).filter(function (i) { return i.campaign_id === cid; }));
    }

    if (path === "/rest/v1/rpc/create_invite" && method === "POST") {
      if (c.createInviteError) return json(400, { code: "P0001", message: c.createInviteError, details: null, hint: null });
      var invites = c.invites || [];
      var id = "30000000-0000-4000-8000-00000000000" + (invites.length + 1);
      var expires = new Date(Date.now() + body.p_ttl_hours * 3600 * 1000).toISOString();
      invites.unshift({ id: id, campaign_id: body.p_campaign_id, label: body.p_label, created_at: new Date().toISOString(), expires_at: expires, max_uses: body.p_max_uses, use_count: 0, revoked_at: null });
      c.invites = invites; save(c);
      return json(200, [{ invite_id: id, code: "ABCDEF0123456789ABCDEF012345AB", expires_at: expires }]);
    }

    if (path === "/rest/v1/rpc/revoke_invite" && method === "POST") {
      if (c.revokeError) return json(400, { code: "P0001", message: c.revokeError, details: null, hint: null });
      var target = (c.invites || []).filter(function (i) { return i.id === body.p_invite_id; })[0];
      if (!target || target.revoked_at) return json(400, { code: "P0001", message: "invite not found, already revoked, or not yours", details: null, hint: null });
      target.revoked_at = new Date().toISOString(); save(c);
      return new Response(null, { status: 204 });
    }

    if (path === "/rest/v1/campaigns") {
      var list = c.campaigns || [];
      if (method === "GET") {
        var idEq = u.searchParams.get("id");
        if (idEq) {
          var found = list.filter(function (x) { return "eq." + x.id === idEq; })[0];
          if (!found || c.hideCampaign) return json(200, []);
          return json(200, [{ id: found.id, name: found.name, dm_id: found.dm_id }]);
        }
        return json(200, list.map(function (x) { return { id: x.id, name: x.name, dm_id: x.dm_id, created_at: x.created_at }; }));
      }
      if (method === "POST") {
        var made = { id: "20000000-0000-4000-8000-00000000000" + (list.length + 1), name: body.name, dm_id: body.dm_id, created_at: new Date().toISOString() };
        list.push(made); c.campaigns = list; save(c);
        return json(201, [{ id: made.id, name: made.name, dm_id: made.dm_id }]);
      }
    }

    var rpcName = path.indexOf("/rest/v1/rpc/") === 0 ? path.slice("/rest/v1/rpc/".length) : "";
    if (ADMIN_RPCS[rpcName] === method) {
      if (!signedIn(input, init)) return json(401, { code: "42501", message: "permission denied for function " + rpcName, details: null, hint: null });
      return adminRpc(c, rpcName, body);
    }

    if (path === "/rest/v1/characters") return characters(c, u, method, body);
    if (path === "/rest/v1/campaign_characters" && method === "GET") return assignments(c, u);
    if (path === "/rest/v1/departed_sheets" && method === "GET") return departed(c, u);
    if (path === "/rest/v1/rpc/choose_character" && method === "POST") return chooseCharacter(c, body);
    if (path === "/rest/v1/rpc/delete_character" && method === "POST") return deleteCharacter(c, body);
    if (path === "/rest/v1/rpc/undelete_character" && method === "POST") return undeleteCharacter(c, body);
    if (path === "/rest/v1/character_history" && method === "GET") return history(c, u);
    if (path === "/rest/v1/rpc/restore_character_version" && method === "POST") return restore(c, body);

    // Previewing, replacing, removing and leaving (migration 0010 and 0001).
    // `c.joinable` maps a code to { id, name, dmName, member }; c.joinError, c.removeError,
    // c.leaveError and c.replaceError make the call fail with that message.
    function rpcError(message) { return json(400, { code: "P0001", message: message, details: null, hint: null }); }
    if (path === "/rest/v1/rpc/preview_invite" && method === "POST") {
      if (c.joinError) return rpcError(c.joinError);
      var previewed = (c.joinable || {})[body.p_invite_code];
      if (!previewed) return rpcError("invalid invite code");
      return json(200, [{ campaign_id: previewed.id, campaign_name: previewed.name, dm_name: previewed.dmName || "The DM", already_member: !!previewed.member }]);
    }
    if (path === "/rest/v1/rpc/replace_invite" && method === "POST") {
      if (c.replaceError) return rpcError(c.replaceError);
      var old = (c.invites || []).filter(function (i) { return i.id === body.p_invite_id; })[0];
      if (!old || old.revoked_at || new Date(old.expires_at) <= new Date() || old.use_count >= old.max_uses) return rpcError("that invite is not active, or is not yours");
      old.revoked_at = new Date().toISOString();
      var replacement = { id: "30000000-0000-4000-8000-0000000000" + String(50 + c.invites.length), campaign_id: old.campaign_id, label: old.label, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 168 * 3600 * 1000).toISOString(), max_uses: Math.max(1, old.max_uses - old.use_count), use_count: 0, revoked_at: null };
      c.invites.unshift(replacement); save(c);
      return json(200, [{ invite_id: replacement.id, code: "REPLACED0123456789ABCDEF012345", expires_at: replacement.expires_at }]);
    }
    if (path === "/rest/v1/rpc/remove_player" && method === "POST") {
      if (c.removeError) return rpcError(c.removeError);
      c.members = (c.members || []).filter(function (m) { return m.player_id !== body.p_player_id; });
      var link = (c.assignments || []).filter(function (a) { return a.campaign_id === body.p_campaign_id && a.player_id === body.p_player_id; })[0];
      if (link) {
        var kept = characterById(c, link.character_id);
        c.departed = c.departed || [];
        c.departed.push({ id: 100 + c.departed.length, campaign_id: link.campaign_id, player_id: link.player_id, character_id: link.character_id, character_name: kept.character_name, schema_version: kept.schema_version, data: kept.data, reason: "removed", kept_at: new Date().toISOString() });
        c.assignments = c.assignments.filter(function (a) { return a !== link && !(a.campaign_id === link.campaign_id && a.player_id === link.player_id); });
      }
      save(c);
      return new Response(null, { status: 204 });
    }
    if (path === "/rest/v1/rpc/leave_campaign" && method === "POST") {
      if (c.leaveError) return rpcError(c.leaveError);
      c.campaigns = (c.campaigns || []).filter(function (x) { return x.id !== body.p_campaign_id; });
      c.assignments = (c.assignments || []).filter(function (a) { return !(a.campaign_id === body.p_campaign_id && a.player_id === PLAYER); });
      save(c);
      return new Response(null, { status: 204 });
    }

    if (path === "/rest/v1/rpc/join_campaign" && method === "POST") {
      if (c.joinError) return json(400, { code: "P0001", message: c.joinError, details: null, hint: null });
      var joinable = (c.joinable || {})[body.p_invite_code];
      if (!joinable) return json(400, { code: "P0001", message: "invalid invite code", details: null, hint: null });
      var camps = c.campaigns || [];
      if (!camps.some(function (x) { return x.id === joinable.id; })) {
        camps.push({ id: joinable.id, name: joinable.name, dm_id: "00000000-0000-4000-8000-0000000000d1", created_at: new Date().toISOString() });
        c.campaigns = camps; save(c);
      }
      return json(200, [{ campaign_id: joinable.id, campaign_name: joinable.name }]);
    }

    return json(404, { message: "fake-supabase: unhandled " + method + " " + path });
  };
})();
