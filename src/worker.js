const FIREBASE_PROJECT_ID = "chitrakatha-studio-os";
const FIREBASE_CERTS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

const json = (body, status = 200, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "referrer-policy": "strict-origin-when-cross-origin",
    ...extraHeaders
  },
});

let userGearSchemaEnsured = false;
async function ensureUserGearTable(db) {
  if (userGearSchemaEnsured || !db) return;
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS user_gear (
      uid TEXT PRIMARY KEY,
      camera TEXT NOT NULL DEFAULT '',
      gear TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    )`).run();
    userGearSchemaEnsured = true;
  } catch (_e) {}
}

let notifSchemaEnsured = false;
async function ensureNotificationsTable(db) {
  if (notifSchemaEnsured || !db) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      recipient_uid TEXT NOT NULL,
      recipient_name TEXT,
      actor_uid TEXT,
      actor_name TEXT,
      deployment_id TEXT,
      kind TEXT NOT NULL DEFAULT 'work_update',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications (recipient_uid, is_read, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS notifications_name_idx ON notifications (recipient_name, is_read, created_at)`)
  ]);
  notifSchemaEnsured = true;
}

async function dispatchWorkNotifications(db, { actorUid, actorName, ownerUid, ownerName, deploymentId, kind = 'work_update', title, message, relatedNames = [] }) {
  try {
    await ensureNotificationsTable(db);
    const allUsers = await db.prepare("SELECT uid, display_name FROM users").all();
    const userList = allUsers.results || [];
    const norm = s => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const targets = new Map();
    const addTarget = (uid, name) => {
      const cleanName = String(name || "").trim();
      const key = norm(cleanName) || uid;
      if (!key) return;
      if (actorUid && uid === actorUid && (!actorName || norm(cleanName) === norm(actorName))) return;
      if (actorName && cleanName && norm(cleanName) === norm(actorName)) return;
      if (!targets.has(key)) targets.set(key, { uid: uid || (cleanName.toLowerCase().replace(/[^a-z0-9]/g, "-") || "member"), name: cleanName || uid });
    };
    if (ownerName || ownerUid) {
      const found = userList.find(u => u.uid === ownerUid || (ownerName && norm(u.display_name) === norm(ownerName)));
      addTarget(found?.uid || ownerUid, found?.display_name || ownerName);
    }
    for (const rawName of relatedNames) {
      const mName = String(rawName || "").trim();
      if (!mName) continue;
      const found = userList.find(u => norm(u.display_name) === norm(mName) || u.uid === mName.toLowerCase().replace(/[^a-z0-9]/g, "-"));
      addTarget(found?.uid || mName.toLowerCase().replace(/[^a-z0-9]/g, "-"), found?.display_name || mName);
    }
    const stmts = [];
    for (const t of targets.values()) {
      stmts.push(
        db.prepare(`INSERT INTO notifications (id, recipient_uid, recipient_name, actor_uid, actor_name, deployment_id, kind, title, message, is_read, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`)
          .bind(crypto.randomUUID(), t.uid, t.name, actorUid || "", actorName || "Studio", deploymentId || "", kind, String(title || "Studio update").slice(0, 160), String(message || "").slice(0, 600))
      );
    }
    if (stmts.length) await db.batch(stmts);
  } catch (e) {
    console.warn("dispatchWorkNotifications skipped:", e?.message || e);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });

    try {
      if (!env.DB) return json({ error: "backend_not_configured" }, 503);
      // Public studio read-only endpoints (accessible for initial load)
      if (url.pathname === "/api/studio-team" && request.method === "GET") {
        await ensureUserGearTable(env.DB);
        let rows;
        try {
          rows = await env.DB.prepare(`
            SELECT u.uid, u.display_name, u.professional_role, u.role, u.photo_data,
                   COALESCE(g.camera, '') AS camera, COALESCE(g.gear, '') AS gear
            FROM users u
            LEFT JOIN user_gear g ON g.uid = u.uid
            WHERE u.status = 'approved'
            ORDER BY u.created_at ASC
          `).all();
        } catch (_e) {
          rows = await env.DB.prepare(
            "SELECT uid, display_name, professional_role, role, photo_data FROM users WHERE status = 'approved' ORDER BY created_at ASC"
          ).all();
        }
        return json({ team: rows.results || [] });
      }
      if (url.pathname === "/api/member-portraits" && request.method === "GET") {
        const rows = await env.DB.prepare("SELECT uid, display_name, photo_data FROM users WHERE photo_data IS NOT NULL").all();
        return json({ portraits: rows.results || [] });
      }

      const user = await authenticate(request);
      if (url.pathname === "/api/me" && request.method === "GET") {
        const userEmail = String(user.email || "").trim().toLowerCase();
        const OWNER_EMAILS = new Set(["dknfbc@gmail.com", "deepshekharojha.1@gmail.com"]);
        const isOwner = OWNER_EMAILS.has(userEmail) ||
                        user.uid === "T4zlc28hy7Tth6wIbWnKZlWotvS2" ||
                        (env.INITIAL_OWNER_UID && user.uid === env.INITIAL_OWNER_UID);
        let profile = await env.DB.prepare(
          "SELECT uid, email, display_name, professional_role, status, role, photo_data FROM users WHERE uid = ?"
        ).bind(user.uid).first();

        // Automatic claiming for pre-enrolled studio members (Upasak, Debraj, Rudra, Sandip)
        if (!profile && !isOwner) {
          const userEmail = String(user.email || "").trim().toLowerCase();
          const userName = String(user.name || "").trim();
          const slug = (userName || userEmail.split('@')[0] || '').toLowerCase().replace(/[^a-z0-9]/g, '-');
          
          const match = await env.DB.prepare(
            "SELECT * FROM users WHERE LOWER(email) = LOWER(?) OR (LOWER(display_name) = LOWER(?) AND ? <> '') OR uid = ?"
          ).bind(userEmail, userName, userName, slug).first();

          if (match && match.uid !== user.uid && String(match.email || "").toLowerCase().endsWith("@chitrakatha.internal")) {
            const oldUid = match.uid;
            // Migrate old assignments, deployments, and photos to this Firebase user.uid
            await env.DB.batch([
              env.DB.prepare("UPDATE deployments SET creator_uid = ? WHERE creator_uid = ?").bind(user.uid, oldUid),
              env.DB.prepare("UPDATE assignments SET freelancer_uid = ? WHERE freelancer_uid = ?").bind(user.uid, oldUid),
              env.DB.prepare("UPDATE availability SET freelancer_uid = ? WHERE freelancer_uid = ?").bind(user.uid, oldUid),
              env.DB.prepare("UPDATE notifications SET owner_uid = ? WHERE owner_uid = ?").bind(user.uid, oldUid),
              env.DB.prepare("DELETE FROM users WHERE uid = ?").bind(oldUid),
              env.DB.prepare(`INSERT INTO users (uid, email, display_name, professional_role, status, role, photo_data, created_at)
                VALUES (?, ?, ?, ?, 'approved', ?, ?, datetime('now'))
                ON CONFLICT(uid) DO UPDATE SET display_name=excluded.display_name, professional_role=excluded.professional_role, status='approved', role=excluded.role, photo_data=COALESCE(excluded.photo_data, users.photo_data)`).bind(
                user.uid, userEmail || match.email, match.display_name, match.professional_role, match.role, match.photo_data
              )
            ]);
            profile = await env.DB.prepare(
              "SELECT uid, email, display_name, professional_role, status, role, photo_data FROM users WHERE uid = ?"
            ).bind(user.uid).first();
          }
        }
        if (isOwner) {
          await env.DB.prepare(`INSERT INTO users (uid, email, display_name, professional_role, status, role, created_at)
            VALUES (?, ?, 'Deep Shekhar', 'Traditional Photographer', 'approved', 'superAdmin', datetime('now'))
            ON CONFLICT(uid) DO UPDATE SET status='approved', role='superAdmin', display_name='Deep Shekhar', professional_role='Traditional Photographer'`).bind(
            user.uid, userEmail || "dknfbc@gmail.com"
          ).run();
          profile = await env.DB.prepare(
            "SELECT uid, email, display_name, professional_role, status, role, photo_data FROM users WHERE uid = ?"
          ).bind(user.uid).first();
        }
        return json({ profile: profile || null });
      }
      if (url.pathname === "/api/access-requests" && request.method === "POST") {
        const body = await readJson(request);
        const displayName = stringField(body.displayName, 100);
        const professionalRole = stringField(body.professionalRole, 100);
        if (!displayName || !professionalRole || !user.email) return json({ error: "invalid_request" }, 400);
        await env.DB.prepare(`INSERT INTO users (uid, email, display_name, professional_role, status, role, created_at)
          VALUES (?, ?, ?, ?, 'pending', 'pending', datetime('now'))
          ON CONFLICT(uid) DO NOTHING`).bind(user.uid, user.email, displayName, professionalRole).run();
        return json({ status: "pending" }, 201);
      }
      if (url.pathname === "/api/bootstrap" && request.method === "POST") {
        const uEmail = String(user.email || "").trim().toLowerCase();
        const isOwnerUser = uEmail === "dknfbc@gmail.com" || uEmail === "deepshekharojha.1@gmail.com" || user.uid === "T4zlc28hy7Tth6wIbWnKZlWotvS2" || (env.INITIAL_OWNER_UID && user.uid === env.INITIAL_OWNER_UID);
        if (!isOwnerUser) return json({ error: "forbidden" }, 403);
        const existing = await env.DB.prepare("SELECT owner_uid FROM bootstrap WHERE id = 1").first();
        if (existing) {
          if (existing.owner_uid !== user.uid) return json({ error: "forbidden" }, 403);
          return json({ status: "bootstrapped", role: "superAdmin" });
        }
        try {
          await env.DB.batch([
            env.DB.prepare("INSERT INTO bootstrap (id, owner_uid, created_at) VALUES (1, ?, datetime('now'))").bind(user.uid),
            env.DB.prepare(`INSERT INTO users (uid, email, display_name, status, role, created_at)
              VALUES (?, ?, ?, 'approved', 'superAdmin', datetime('now'))`).bind(user.uid, user.email || "", user.name || ""),
          ]);
        } catch (error) {
          const winner = await env.DB.prepare("SELECT owner_uid FROM bootstrap WHERE id = 1").first();
          if (winner?.owner_uid !== user.uid) throw error;
        }
        return json({ status: "bootstrapped", role: "superAdmin" }, 201);
      }
      const review = url.pathname.match(/^\/api\/admin\/access-requests\/([^/]+)$/);
      if (review && request.method === "POST") {
        const actor = await env.DB.prepare("SELECT role, status, display_name FROM users WHERE uid = ?").bind(user.uid).first();
        if (!actor || actor.role !== "superAdmin" || actor.status !== "approved") return json({ error: "forbidden" }, 403);
        const body = await readJson(request);
        if (!new Set(["approve", "reject"]).has(body.action)) return json({ error: "invalid_action" }, 400);
        const reqRole = String(body.role || "");
        if (body.action === "approve" && !new Set(["deployer", "freelancer", "deployer_freelancer"]).has(reqRole)) return json({ error: "invalid_role" }, 400);
        const dbRole = body.action === "approve" ? (reqRole === "deployer_freelancer" ? "deployer" : reqRole) : "rejected";
        const targetUid = decodeURIComponent(review[1]);
        const targetUser = await env.DB.prepare("SELECT display_name, professional_role FROM users WHERE uid = ?").bind(targetUid).first();
        let nextProfRole = targetUser?.professional_role || "";
        if (body.action === "approve" && reqRole === "deployer_freelancer" && !nextProfRole.toLowerCase().includes("deployer + freelancer")) {
          nextProfRole = nextProfRole ? (nextProfRole + " · Deployer + Freelancer") : "Deployer + Freelancer";
        }
        const result = await env.DB.prepare(`UPDATE users SET status = ?, role = ?, professional_role = ?
          WHERE uid = ? AND status = 'pending' AND role = 'pending'`).bind(
          body.action === "approve" ? "approved" : "rejected", dbRole, nextProfRole, targetUid
        ).run();
        if (result.meta.changes && body.action === "approve") {
          await dispatchWorkNotifications(env.DB, {
            actorUid: user.uid,
            actorName: actor.display_name || "Chitrakatha Studio",
            ownerUid: targetUid,
            ownerName: targetUser?.display_name || "",
            kind: "account_approved",
            title: "Account approved",
            message: `Your Chitrakatha Studio OS account is now active (${reqRole === "deployer_freelancer" ? "Deployer + Freelancer" : dbRole}).`
          });
        }
        return result.meta.changes ? json({ status: body.action === "approve" ? "approved" : "rejected" }) : json({ error: "request_not_pending" }, 409);
      }
      if (url.pathname === "/api/notifications" && request.method === "GET") {
        await ensureNotificationsTable(env.DB);
        const viewer = await env.DB.prepare("SELECT uid, display_name, status FROM users WHERE uid = ?").bind(user.uid).first();
        if (viewer?.status !== "approved") return json({ notifications: [], unreadCount: 0 });
        const vName = String(viewer.display_name || "").trim();
        const rows = await env.DB.prepare(`SELECT id, kind, title, message, deployment_id, actor_name, is_read, created_at
          FROM notifications
          WHERE recipient_uid = ? OR (LOWER(COALESCE(recipient_name, '')) = LOWER(?) AND ? <> '')
          ORDER BY created_at DESC LIMIT 40`).bind(user.uid, vName, vName).all();
        const list = rows.results || [];
        const unreadCount = list.filter(x => !x.is_read).length;
        return json({ notifications: list, unreadCount });
      }
      if (url.pathname === "/api/notifications/read" && request.method === "POST") {
        await ensureNotificationsTable(env.DB);
        const viewer = await env.DB.prepare("SELECT uid, display_name FROM users WHERE uid = ?").bind(user.uid).first();
        const vName = String(viewer?.display_name || "").trim();
        const body = await readJson(request).catch(() => ({}));
        if (body.all) {
          await env.DB.prepare(`UPDATE notifications SET is_read = 1 WHERE recipient_uid = ? OR (LOWER(COALESCE(recipient_name, '')) = LOWER(?) AND ? <> '')`).bind(user.uid, vName, vName).run();
        } else if (body.id) {
          await env.DB.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND (recipient_uid = ? OR (LOWER(COALESCE(recipient_name, '')) = LOWER(?) AND ? <> ''))`).bind(String(body.id), user.uid, vName, vName).run();
        }
        return json({ ok: true });
      }
      if (url.pathname === "/api/notifications/delete" && request.method === "POST") {
        await ensureNotificationsTable(env.DB);
        const viewer = await env.DB.prepare("SELECT uid, display_name FROM users WHERE uid = ?").bind(user.uid).first();
        const vName = String(viewer?.display_name || "").trim();
        const body = await readJson(request).catch(() => ({}));
        if (body.all) {
          await env.DB.prepare(`DELETE FROM notifications WHERE recipient_uid = ? OR (LOWER(COALESCE(recipient_name, '')) = LOWER(?) AND ? <> '')`).bind(user.uid, vName, vName).run();
        } else if (body.id) {
          await env.DB.prepare(`DELETE FROM notifications WHERE id = ? AND (recipient_uid = ? OR (LOWER(COALESCE(recipient_name, '')) = LOWER(?) AND ? <> ''))`).bind(String(body.id), user.uid, vName, vName).run();
        }
        return json({ ok: true });
      }
      

      if (url.pathname === "/api/admin/access-requests" && request.method === "GET") {
        if (!await isSuperAdmin(env.DB, user.uid, user.email)) return json({ error: "forbidden" }, 403);
        const rows = await env.DB.prepare("SELECT uid, email, display_name, professional_role, created_at FROM users WHERE status = 'pending' ORDER BY created_at").all();
        return json({ requests: rows.results || [] });
      }
      if (url.pathname === "/api/admin/deployers" && request.method === "GET") {
        if (!await isSuperAdmin(env.DB, user.uid, user.email)) return json({ error: "forbidden" }, 403);
        const rows = await env.DB.prepare("SELECT uid, COALESCE(NULLIF(display_name, ''), 'Studio Member') AS display_name, professional_role FROM users WHERE status = 'approved' AND role = 'deployer' ORDER BY display_name").all();
        const studioRoster = [
          { uid: "T4zlc28hy7Tth6wIbWnKZlWotvS2", display_name: "Deep Shekhar", professional_role: "Traditional Photographer", isSelf: user.uid === "T4zlc28hy7Tth6wIbWnKZlWotvS2" },
          { uid: "DdVRg5L8evXTdDtEN7WTDWOrZ2u1", display_name: "Upasak Mukherjee", professional_role: "Cinematographer / Photographer", isSelf: user.uid === "DdVRg5L8evXTdDtEN7WTDWOrZ2u1" },
          { uid: "debraj-roy", display_name: "Debraj Roy", professional_role: "Candid Photographer" },
          { uid: "rudra-pratap-sen", display_name: "Rudra Pratap Sen", professional_role: "Candid Photographer" },
          { uid: "xri4yPGgxbWiUiljqIEUYOfsf8M2", display_name: "Sandip Pal", professional_role: "Cinematographer / Photographer", isSelf: user.uid === "xri4yPGgxbWiUiljqIEUYOfsf8M2" }
        ];
        const existingUids = new Set((rows.results || []).map(r => r.uid));
        const merged = [...studioRoster.filter(r => r.isSelf || !existingUids.has(r.uid)), ...(rows.results || []).filter(r => r.uid !== user.uid)];
        return json({ deployers: merged });
      }
      if (url.pathname === "/api/deployments" && request.method === "POST") {
        const viewer = await env.DB.prepare("SELECT status, role, display_name FROM users WHERE uid = ?").bind(user.uid).first();
        if (viewer?.status !== "approved" || !new Set(["deployer", "superAdmin"]).has(viewer.role)) return json({ error: "forbidden" }, 403);
        const body = await readJson(request);
        const title = stringField(body.client || body.title, 160) || "Studio work";
        const eventType = stringField(body.type || body.eventType, 80) || "Wedding";
        const side = stringField(body.side, 60) || "Event";
        const depId = crypto.randomUUID();
        const rawDays = Array.isArray(body.days) ? body.days : [];
        const topAssignments = rawDays.flatMap(day => [...(day.assignments || []), ...(day.shifts || [])]).filter(a => a && a.member);
        const ownerName = viewer.display_name || "Deep Shekhar";
        const details = JSON.stringify({
          client: title,
          eventType,
          side,
          names: typeof body.names === "string" ? body.names.slice(0, 240) : "",
          summary: typeof body.notes === "string" ? body.notes.slice(0, 12000) : "",
          assignments: topAssignments,
          finances: body.finances && typeof body.finances === "object" ? body.finances : null,
          deliverables: body.deliverables && typeof body.deliverables === "object" ? body.deliverables : null,
          ownerName
        });
        const statements = [
          env.DB.prepare(`INSERT INTO deployments (id, creator_uid, created_by_uid, status, event_type, title, details_json, created_at, updated_at)
            VALUES (?, ?, ?, 'draft', ?, ?, ?, datetime('now'), datetime('now'))`).bind(depId, user.uid, user.uid, eventType, title, details)
        ];
        for (const day of rawDays) {
          if (!day || !day.date) continue;
          const dayDetails = JSON.stringify({
            kind: day.kind || eventType || "Work",
            location: day.location || "",
            time: day.time || "",
            notes: day.note || day.notes || "",
            extra: day.extra || "",
            plans: Array.isArray(day.plans) ? day.plans : undefined,
            assignments: Array.isArray(day.assignments) ? day.assignments : [],
            shifts: Array.isArray(day.shifts) ? day.shifts : []
          });
          statements.push(env.DB.prepare("INSERT INTO deployment_days (id, deployment_id, work_date, details_json) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), depId, day.date, dayDetails));
        }
        await env.DB.batch(statements);
        await dispatchWorkNotifications(env.DB, {
          actorUid: user.uid,
          actorName: ownerName,
          deploymentId: depId,
          kind: "work_created",
          title: `New assignment: ${title}`,
          message: `${ownerName} added you to ${title} (${eventType}${rawDays[0]?.date ? " · " + rawDays[0].date : ""}).`,
          relatedNames: topAssignments.map(a => a.member)
        });
        return json({ ok: true, id: depId, ownerName }, 201);
      }
      const deploymentRouteMatch = url.pathname.match(/^\/api\/deployments\/([^/]+)$/);
      if (deploymentRouteMatch && request.method === "DELETE") {
        const isSuper = await isSuperAdmin(env.DB, user.uid, user.email);
        const actor = await env.DB.prepare("SELECT display_name FROM users WHERE uid = ?").bind(user.uid).first();
        const depId = decodeURIComponent(deploymentRouteMatch[1]);
        const dep = await env.DB.prepare("SELECT id, creator_uid, created_by_uid, import_id, title, event_type, details_json FROM deployments WHERE id = ?").bind(depId).first();
        if (!dep) return json({ error: "not_found" }, 404);
        if (!isSuper && dep.creator_uid !== user.uid && dep.created_by_uid !== user.uid) {
          return json({ error: "forbidden" }, 403);
        }
        let depDetails = {}; try { depDetails = JSON.parse(dep.details_json || "{}"); } catch {}
        const dayRows = await env.DB.prepare("SELECT details_json FROM deployment_days WHERE deployment_id = ?").bind(depId).all();
        const affectedMembers = new Set((depDetails.assignments || []).map(a => a?.member).filter(Boolean));
        for (const dr of dayRows.results || []) {
          try {
            const dj = JSON.parse(dr.details_json || "{}");
            [...(dj.assignments || []), ...(dj.shifts || [])].forEach(a => { if (a?.member) affectedMembers.add(a.member); });
          } catch {}
        }
        const statements = [
          env.DB.prepare("DELETE FROM deployments WHERE id = ?").bind(depId),
          env.DB.prepare("DELETE FROM deployment_days WHERE deployment_id = ?").bind(depId)
        ];
        if (dep.import_id) {
          statements.push(env.DB.prepare("DELETE FROM admin_imports WHERE id = ?").bind(dep.import_id));
        }
        await env.DB.batch(statements);
        await dispatchWorkNotifications(env.DB, {
          actorUid: user.uid,
          actorName: actor?.display_name || "Deep Shekhar",
          ownerUid: dep.creator_uid,
          ownerName: depDetails.ownerName || "",
          deploymentId: depId,
          kind: "work_deleted",
          title: `Work removed: ${dep.title || "Studio work"}`,
          message: `The booking "${dep.title || dep.event_type || "Studio work"}" has been cancelled or removed.`,
          relatedNames: [...affectedMembers]
        });
        return json({ ok: true, deleted: depId });
      }
      if (deploymentRouteMatch && request.method === "PUT") {
        const isSuper = await isSuperAdmin(env.DB, user.uid, user.email);
        const actor = await env.DB.prepare("SELECT display_name FROM users WHERE uid = ?").bind(user.uid).first();
        const depId = decodeURIComponent(deploymentRouteMatch[1]);
        const dep = await env.DB.prepare("SELECT id, creator_uid, created_by_uid, import_id, details_json FROM deployments WHERE id = ?").bind(depId).first();
        if (!dep) return json({ error: "not_found" }, 404);
        if (!isSuper && dep.creator_uid !== user.uid && dep.created_by_uid !== user.uid) {
          return json({ error: "forbidden" }, 403);
        }
        const body = await readJson(request);
        const title = stringField(body.title || body.client, 160);
        const eventType = stringField(body.eventType || body.type, 80) || "Work";
        const side = stringField(body.side, 60) || "Event";
        const ownerUid = normalizeOwnerUid(stringField(body.ownerUid || dep.creator_uid, 128));
        const profRole = (ownerUid === 'DdVRg5L8evXTdDtEN7WTDWOrZ2u1' || String(body.ownerName||'').toLowerCase().includes('upasak')) ? 'Cinematographer / Photographer' : 'Traditional Photographer';
        const ownerName = stringField(body.ownerName, 128) || (ownerUid.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()));
        if (isSuper && ownerUid && ownerUid !== user.uid && !ownerUid.startsWith('T4')) {
          const mockEmail = (ownerUid.toLowerCase().replace(/[^a-z0-9]/g, '') || 'member') + '@chitrakatha.internal';
          await env.DB.prepare(`INSERT INTO users (uid, email, display_name, professional_role, status, role, created_at)
            VALUES (?, ?, ?, ?, 'approved', 'deployer', datetime('now'))
            ON CONFLICT(uid) DO UPDATE SET display_name = excluded.display_name, status = 'approved', professional_role = excluded.professional_role`).bind(ownerUid, mockEmail, ownerName, profRole).run();
        }
        let existingDetails = {}; try { existingDetails = JSON.parse(dep.details_json || "{}"); } catch {}
        const isOwnWork = ownerUid === user.uid;
        const topAssignments = Array.isArray(body.assignments) ? body.assignments : [];
        const details = JSON.stringify({
          client: title,
          eventType,
          side,
          summary: typeof body.notes === 'string' ? body.notes.slice(0, 12000) : '',
          assignments: topAssignments,
          finances: isOwnWork ? (body.finances || existingDetails.finances || null) : (existingDetails.finances || null),
          deliverables: body.deliverables || existingDetails.deliverables || null,
          ownerName
        });
        const statements = [
          env.DB.prepare("UPDATE deployments SET title = ?, event_type = ?, creator_uid = ?, details_json = ?, updated_at = datetime('now') WHERE id = ?").bind(title, eventType, ownerUid, details, depId),
          env.DB.prepare("DELETE FROM deployment_days WHERE deployment_id = ?").bind(depId)
        ];
        const rawDays = Array.isArray(body.days || body.workDays) ? (body.days || body.workDays) : [];
        const allAffected = new Set(topAssignments.map(a => a?.member).filter(Boolean));
        for (const day of rawDays) {
          if (!day || !day.date) continue;
          const dayAssignments = Array.isArray(day.assignments) && day.assignments.length ? day.assignments : topAssignments;
          const dayShifts = Array.isArray(day.shifts) ? day.shifts : [];
          [...dayAssignments, ...dayShifts].forEach(a => { if (a?.member) allAffected.add(a.member); });
          const dayDetails = JSON.stringify({
            kind: day.kind || eventType || 'Work',
            location: day.location || '',
            time: day.time || '',
            notes: day.notes || day.note || '',
            extra: day.extra || '',
            plans: Array.isArray(day.plans) ? day.plans : undefined,
            assignments: dayAssignments,
            shifts: dayShifts
          });
          statements.push(env.DB.prepare("INSERT INTO deployment_days (id, deployment_id, work_date, details_json) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), depId, day.date, dayDetails));
        }
        await env.DB.batch(statements);
        await dispatchWorkNotifications(env.DB, {
          actorUid: user.uid,
          actorName: actor?.display_name || "Deep Shekhar",
          ownerUid,
          ownerName,
          deploymentId: depId,
          kind: "work_updated",
          title: `Work updated: ${title || "Studio work"}`,
          message: `${actor?.display_name || "Studio"} updated details or schedule for ${title || eventType}${rawDays[0]?.date ? " (" + rawDays[0].date + ")" : ""}.`,
          relatedNames: [...allAffected]
        });
        return json({ ok: true, id: depId });
      }
      if (url.pathname === "/api/deployer/deployments" && request.method === "GET") {
        const viewer = await env.DB.prepare("SELECT status, role, display_name FROM users WHERE uid = ?").bind(user.uid).first();
        if (viewer?.status !== "approved" || !new Set(["deployer", "superAdmin", "freelancer"]).has(viewer.role)) return json({ error: "forbidden" }, 403);
        const viewerName = String(viewer.display_name || "").trim();
        const nameMatchLike = viewerName ? ("%" + viewerName + "%") : "%__none__%";
        const rows = viewer.role === "superAdmin"
          ? await env.DB.prepare(`SELECT d.id, d.creator_uid, d.created_by_uid, COALESCE(NULLIF(u.display_name, ''), 'Deep Shekhar') AS owner_name, d.status, d.event_type, d.title, d.details_json, d.created_at, d.updated_at
              FROM deployments d LEFT JOIN users u ON u.uid = d.creator_uid
              WHERE d.status <> 'cancelled'
              ORDER BY d.created_at DESC LIMIT 150`).all()
          : await env.DB.prepare(`SELECT d.id, d.creator_uid, d.created_by_uid, COALESCE(NULLIF(u.display_name, ''), 'Deep Shekhar') AS owner_name, d.status, d.event_type, d.title, d.details_json, d.created_at, d.updated_at
              FROM deployments d LEFT JOIN users u ON u.uid = d.creator_uid
              WHERE (
                d.creator_uid = ? 
                OR d.created_by_uid = ?
                OR d.id IN (SELECT deployment_id FROM assignments WHERE freelancer_uid = ?)
                OR (LOWER(COALESCE(u.display_name, '')) = LOWER(?) AND ? <> '') 
                OR d.details_json LIKE ?
              ) AND d.status <> 'cancelled' ORDER BY d.created_at DESC LIMIT 150`).bind(user.uid, user.uid, user.uid, viewerName, viewerName, nameMatchLike).all();
        const items = (rows.results || []).map((row) => ({ ...row, days: [] }));
        if (items.length) {
          const ids = items.map((item) => item.id), marks = ids.map(() => "?").join(",");
          const days = await env.DB.prepare(`SELECT id, deployment_id, work_date, details_json FROM deployment_days WHERE deployment_id IN (${marks}) ORDER BY work_date`).bind(...ids).all();
          const byId = new Map(items.map((item) => [item.id, item]));
          for (const day of days.results || []) byId.get(day.deployment_id)?.days.push(day);
        }
        // Strict server-side financial isolation:
        // Super Admin / viewer may ONLY see client finances for deployments they own (creator_uid === user.uid),
        // and may ONLY see freelancer payout fields on assignments that belong to themselves.
        const normViewer = viewerName.toLowerCase().replace(/[^a-z0-9]/g, "");
        const sanitizeAssigns = (list, isCreator) => (Array.isArray(list) ? list : []).map(a => {
          if (!a || typeof a !== "object") return a;
          const normM = String(a.member || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          const isSelfAssign = !!(normViewer && normM && (normM === normViewer || normM.includes(normViewer) || normViewer.includes(normM)));
          if (isCreator || isSelfAssign) return a;
          const copy = { ...a };
          delete copy.pay;
          delete copy.advance;
          delete copy.payStatus;
          return copy;
        });
        for (const item of items) {
          const isCreator = item.creator_uid === user.uid;
          try {
            const det = JSON.parse(item.details_json || "{}");
            if (!isCreator) delete det.finances;
            if (Array.isArray(det.assignments)) det.assignments = sanitizeAssigns(det.assignments, isCreator);
            item.details_json = JSON.stringify(det);
          } catch {}
          for (const day of item.days) {
            try {
              const dd = JSON.parse(day.details_json || "{}");
              if (Array.isArray(dd.assignments)) dd.assignments = sanitizeAssigns(dd.assignments, isCreator);
              if (Array.isArray(dd.shifts)) dd.shifts = sanitizeAssigns(dd.shifts, isCreator);
              day.details_json = JSON.stringify(dd);
            } catch {}
          }
        }
        return json({ deployments: items });
      }
      if (url.pathname === "/api/deployer/imports" && request.method === "GET") {
        const viewer = await env.DB.prepare("SELECT status, role FROM users WHERE uid = ?").bind(user.uid).first();
        if (viewer?.status !== "approved" || viewer.role !== "deployer") return json({ error: "forbidden" }, 403);
        const rows = await env.DB.prepare(`SELECT id, source_type, source_text, source_file_data, extracted_json, confirmation_status, created_at
          FROM admin_imports WHERE original_owner_uid = ? AND confirmation_status = 'unconfirmed' ORDER BY created_at DESC LIMIT 100`).bind(user.uid).all();
        return json({ imports: rows.results || [] });
      }
      const deployerImportReview = url.pathname.match(/^\/api\/deployer\/imports\/([^/]+)$/);
      if (deployerImportReview && request.method === "POST") {
        const viewer = await env.DB.prepare("SELECT status, role FROM users WHERE uid = ?").bind(user.uid).first();
        if (viewer?.status !== "approved" || viewer.role !== "deployer") return json({ error: "forbidden" }, 403);
        const body = await readJson(request);
        if (!new Set(["review", "reject"]).has(body.action)) return json({ error: "invalid_action" }, 400);
        const next = body.action === "review" ? "reviewed" : "rejected";
        const id = decodeURIComponent(deployerImportReview[1]);
        const imported = await env.DB.prepare(`SELECT id, original_owner_uid, imported_by_uid, source_type, extracted_json
          FROM admin_imports WHERE id = ? AND original_owner_uid = ? AND confirmation_status = 'unconfirmed'`).bind(id, user.uid).first();
        if (!imported) return json({ error: "import_not_pending" }, 409);
        const statements = [];
        let deploymentId = null;
        if (body.action === "review") {
          let extracted = {};
          try { extracted = JSON.parse(imported.extracted_json || "{}"); } catch {}
          const days = Array.isArray(extracted.workDays) ? extracted.workDays.filter((day) => day?.date) : [];
          const existingDraft = await env.DB.prepare("SELECT id FROM deployments WHERE import_id = ? LIMIT 1").bind(id).first();
          if (days.length && !existingDraft) {
            deploymentId = crypto.randomUUID();
            const details = JSON.stringify({ source: "super_admin_import", importId: id, sourceType: imported.source_type, summary: extracted.details || "" });
            statements.push(env.DB.prepare(`INSERT INTO deployments (id, creator_uid, created_by_uid, import_id, status, event_type, title, details_json, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'details_pending', ?, ?, ?, datetime('now'), datetime('now'))`).bind(
              deploymentId, user.uid, imported.imported_by_uid, id, stringField(extracted.eventType, 80) || "Work", stringField(extracted.client, 160), details
            ));
            for (const day of days) {
              statements.push(env.DB.prepare(`INSERT INTO deployment_days (id, deployment_id, work_date, details_json) VALUES (?, ?, ?, ?)`)
                .bind(crypto.randomUUID(), deploymentId, day.date, JSON.stringify({ kind: day.kind || "", location: day.location || "", time: day.time || "", notes: day.notes || "" })));
            }
          }
        }
        statements.push(env.DB.prepare(`UPDATE admin_imports SET confirmation_status = ? WHERE id = ? AND original_owner_uid = ? AND confirmation_status = 'unconfirmed'`).bind(next, id, user.uid));
        await env.DB.batch(statements);
        return json({ confirmation_status: next, deploymentId });
      }
      const adminImportMatch = url.pathname.match(/^\/api\/admin\/imports\/([^/]+)$/);
      if (adminImportMatch && request.method === "DELETE") {
        if (!await isSuperAdmin(env.DB, user.uid, user.email)) return json({ error: "forbidden" }, 403);
        const impId = decodeURIComponent(adminImportMatch[1]);
        await env.DB.batch([
          env.DB.prepare("DELETE FROM admin_imports WHERE id = ?").bind(impId),
          env.DB.prepare("DELETE FROM deployments WHERE import_id = ?").bind(impId)
        ]);
        return json({ ok: true, deleted: impId });
      }
      if (url.pathname === "/api/admin/imports" && request.method === "GET") {
        if (!await isSuperAdmin(env.DB, user.uid, user.email)) return json({ error: "forbidden" }, 403);
        const rows = await env.DB.prepare(`SELECT i.id, i.original_owner_uid, COALESCE(NULLIF(u.display_name, ''), 'Deep Shekhar') AS owner_name, i.source_type,
          i.source_text, i.extracted_json, i.confirmation_status, i.created_at
          FROM admin_imports i LEFT JOIN users u ON u.uid = i.original_owner_uid
          ORDER BY i.created_at DESC LIMIT 100`).all();
        return json({ imports: rows.results || [] });
      }
      if (url.pathname === "/api/admin/imports" && request.method === "POST") {
        const isSuper = await isSuperAdmin(env.DB, user.uid, user.email);
        if (!isSuper) return json({ error: "forbidden" }, 403);
        const body = await readJson(request);
        const ownerUid = normalizeOwnerUid(stringField(body.ownerUid, 128)), sourceType = body.sourceType;
        if (!new Set(["manual", "text", "photo", "historical"]).has(sourceType)) return json({ error: "invalid_source_type" }, 400);
        let owner = await env.DB.prepare("SELECT uid, display_name, role FROM users WHERE uid = ? AND status = 'approved' AND (role = 'deployer' OR (uid = ? AND role = 'superAdmin'))").bind(ownerUid, user.uid).first();
        const ownerName = stringField(body.ownerName, 128) || (owner?.display_name) || (ownerUid.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()));
        if (!owner && ownerUid !== user.uid && !ownerUid.startsWith('T4')) {
          // If Super Admin is deploying on behalf of an unenrolled studio member (e.g. Upasak Mukherjee), upsert user record
          const mockEmail = (ownerUid.toLowerCase().replace(/[^a-z0-9]/g, '') || 'member') + '@chitrakatha.internal';
          const impProfRole = (ownerUid === 'DdVRg5L8evXTdDtEN7WTDWOrZ2u1' || String(ownerName||'').toLowerCase().includes('upasak')) ? 'Cinematographer / Photographer' : 'Traditional Photographer';
          await env.DB.prepare(`INSERT INTO users (uid, email, display_name, professional_role, status, role, created_at)
            VALUES (?, ?, ?, ?, 'approved', 'deployer', datetime('now'))
            ON CONFLICT(uid) DO UPDATE SET display_name = excluded.display_name, status = 'approved', professional_role = excluded.professional_role`).bind(ownerUid, mockEmail, ownerName, impProfRole).run();
          owner = { uid: ownerUid, display_name: ownerName, role: 'deployer' };
        }
        const eventType = stringField(body.eventType, 80);
        const side = stringField(body.side, 60) || "Event";
        const rawDays = Array.isArray(body.workDays) ? body.workDays : body.workDate ? [{ date: body.workDate }] : [];
        if (rawDays.length > 30) return json({ error: "too_many_work_days" }, 400);
        const topAssignments = Array.isArray(body.assignments) ? body.assignments : [];
        const workDays = [];
        for (const day of rawDays) {
          if (!day || typeof day !== "object") return json({ error: "invalid_work_day" }, 400);
          const date = day.date === "" || day.date == null ? "" : validDate(day.date);
          if (day.date && !date) return json({ error: "invalid_date" }, 400);
          const plan = typeof day.kind === "string" ? day.kind.slice(0, 160) : "";
          const location = typeof day.location === "string" ? day.location.slice(0, 240) : "";
          const time = typeof day.time === "string" ? day.time.slice(0, 80) : "";
          const notes = typeof day.notes === "string" ? day.notes.slice(0, 1000) : "";
          const dayPlans = Array.isArray(day.plans) ? day.plans : undefined;
          const dayAssignments = Array.isArray(day.assignments) && day.assignments.length ? day.assignments : topAssignments;
          if (date || plan || location || time || notes || dayAssignments.length) workDays.push({ date, kind: plan, location, time, notes, plans: dayPlans, assignments: dayAssignments });
        }
        const sourceText = typeof body.sourceText === "string" ? body.sourceText.slice(0, 20000) : "";
        const fileData = body.fileData == null ? null : validImageData(body.fileData, 300000);
        if (body.fileData && !fileData) return json({ error: "image_must_be_valid_and_under_300kb" }, 400);
        if (!sourceText && !fileData && !eventType && !workDays.length) return json({ error: "add_source_or_work_details" }, 400);
        const id = crypto.randomUUID();
        const details = JSON.stringify({ eventType, side, workDays, workDate: workDays[0]?.date || "", client: stringField(body.client, 160), details: typeof body.details === "string" ? body.details.slice(0, 12000) : "", assignments: topAssignments, ownerName });
        const selfOwner = ownerUid === user.uid;
        const status = selfOwner ? "reviewed" : "unconfirmed";
        const statements = [env.DB.prepare(`INSERT INTO admin_imports (id, original_owner_uid, imported_by_uid, source_type, source_text, source_file_data, extracted_json, confirmation_status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).bind(id, ownerUid, user.uid, sourceType, sourceText, fileData, details, status)];
        let deploymentId = null;
        const datedWorkDays = workDays.filter((day) => day.date);
        if (datedWorkDays.length) {
          deploymentId = crypto.randomUUID();
          const draftDetails = JSON.stringify({ source: "super_admin_entry", importId: id, sourceType, side, summary: typeof body.details === "string" ? body.details.slice(0, 12000) : "", assignments: topAssignments, ownerName });
          statements.push(env.DB.prepare(`INSERT INTO deployments (id, creator_uid, created_by_uid, import_id, status, event_type, title, details_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'details_pending', ?, ?, ?, datetime('now'), datetime('now'))`).bind(deploymentId, ownerUid, user.uid, id, eventType || "Work", stringField(body.client, 160), draftDetails));
          for (const day of datedWorkDays) statements.push(env.DB.prepare(`INSERT INTO deployment_days (id, deployment_id, work_date, details_json) VALUES (?, ?, ?, ?)`)
            .bind(crypto.randomUUID(), deploymentId, day.date, JSON.stringify({ kind: day.kind, location: day.location, time: day.time, notes: day.notes, plans: day.plans, shifts: day.shifts || [], assignments: day.assignments || topAssignments })));
        }
        await env.DB.batch(statements);
        const impAffected = [...new Set([
          ...topAssignments.map(a => a?.member),
          ...datedWorkDays.flatMap(d => [...(d.assignments || []), ...(d.shifts || [])].map(a => a?.member))
        ].filter(Boolean))];
        await dispatchWorkNotifications(env.DB, {
          actorUid: user.uid,
          actorName: "Deep Shekhar",
          ownerUid,
          ownerName,
          deploymentId: deploymentId || id,
          kind: "work_created",
          title: `New studio booking: ${stringField(body.client, 160) || eventType || "Studio work"}`,
          message: `${selfOwner ? "Deep Shekhar" : ("On behalf of " + ownerName)} locked ${datedWorkDays.map(d => d.date).join(", ") || "dates"} for ${eventType || "Work"}.`,
          relatedNames: impAffected
        });
        return json({ importId: id, status, deploymentId }, 201);
      }
      if (url.pathname === "/api/admin/season-dates" && request.method === "GET") {
        if (!await isSuperAdmin(env.DB, user.uid, user.email)) return json({ error: "forbidden" }, 403);
        const rows = await env.DB.prepare("SELECT id, work_date, source, category, confirmation_status, notes, source_image_data FROM season_dates ORDER BY work_date LIMIT 500").all();
        return json({ dates: rows.results || [] });
      }
      if (url.pathname === "/api/season-dates" && request.method === "GET") {
        const viewer = await env.DB.prepare("SELECT status FROM users WHERE uid = ?").bind(user.uid).first();
        if (viewer?.status !== "approved") return json({ error: "forbidden" }, 403);
        const rows = await env.DB.prepare("SELECT work_date, category, source, notes FROM season_dates WHERE confirmation_status = 'confirmed' ORDER BY work_date LIMIT 500").all();
        return json({ dates: rows.results || [] });
      }
      if (url.pathname === "/api/admin/season-dates" && request.method === "POST") {
        if (!await isSuperAdmin(env.DB, user.uid, user.email)) return json({ error: "forbidden" }, 403);
        const body = await readJson(request), date = validDate(body.date);
        if (!date || !stringField(body.source, 160) || !new Set(["bengali_panjika", "hindu_panchang"]).has(body.category)) return json({ error: "invalid_season_date" }, 400);
        const sourceImage = body.sourceImage == null || body.sourceImage === "" ? null : validImageData(body.sourceImage, 300000);
        if (body.sourceImage && !sourceImage) return json({ error: "source_photo_must_be_valid_and_under_300kb" }, 400);
        const id = crypto.randomUUID();
        await env.DB.prepare(`INSERT INTO season_dates (id, work_date, source, category, confirmation_status, notes, created_by_uid, created_at, source_image_data)
          VALUES (?, ?, ?, ?, 'unconfirmed', ?, ?, datetime('now'), ?)`).bind(id, date, stringField(body.source, 160), body.category, typeof body.notes === "string" ? body.notes.slice(0, 4000) : "", user.uid, sourceImage).run();
        return json({ id, confirmation_status: "unconfirmed" }, 201);
      }
      const seasonReview = url.pathname.match(/^\/api\/admin\/season-dates\/([^/]+)$/);
      if (seasonReview && request.method === "POST") {
        if (!await isSuperAdmin(env.DB, user.uid, user.email)) return json({ error: "forbidden" }, 403);
        const body = await readJson(request);
        if (!new Set(["confirm", "reject"]).has(body.action)) return json({ error: "invalid_action" }, 400);
        const status = body.action === "confirm" ? "confirmed" : "rejected";
        const result = await env.DB.prepare("UPDATE season_dates SET confirmation_status = ? WHERE id = ? AND confirmation_status = 'unconfirmed'").bind(status, decodeURIComponent(seasonReview[1])).run();
        return result.meta.changes ? json({ confirmation_status: status }) : json({ error: "date_not_unconfirmed" }, 409);
      }
      if (url.pathname === "/api/admin/backgrounds" && request.method === "GET") {
        if (!await isSuperAdmin(env.DB, user.uid, user.email)) return json({ error: "forbidden" }, 403);
        const rows = await env.DB.prepare("SELECT event_type, image_data, updated_at FROM event_backgrounds ORDER BY event_type").all();
        return json({ backgrounds: rows.results || [] });
      }
      if (url.pathname === "/api/event-backgrounds" && request.method === "GET") {
        const viewer = await env.DB.prepare("SELECT status FROM users WHERE uid = ?").bind(user.uid).first();
        if (viewer?.status !== "approved") return json({ error: "forbidden" }, 403);
        const rows = await env.DB.prepare("SELECT event_type, image_data FROM event_backgrounds ORDER BY event_type").all();
        return json({ backgrounds: rows.results || [] });
      }
      if (url.pathname === "/api/admin/backgrounds" && request.method === "POST") {
        if (!await isSuperAdmin(env.DB, user.uid, user.email)) return json({ error: "forbidden" }, 403);
        const body = await readJson(request), eventType = stringField(body.eventType, 80), image = validImageData(body.imageData, 300000);
        if (!eventType || !image) return json({ error: "background_image_required_under_300kb" }, 400);
        await env.DB.prepare(`INSERT INTO event_backgrounds (event_type, image_data, updated_by_uid, updated_at) VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(event_type) DO UPDATE SET image_data = excluded.image_data, updated_by_uid = excluded.updated_by_uid, updated_at = excluded.updated_at`).bind(eventType, image, user.uid).run();
        return json({ eventType, saved: true });
      }
      if (url.pathname === "/api/profile/gear" && request.method === "POST") {
        await ensureUserGearTable(env.DB);
        const viewer = await env.DB.prepare("SELECT status, display_name FROM users WHERE uid = ?").bind(user.uid).first();
        if (viewer?.status !== "approved") return json({ error: "forbidden" }, 403);
        const body = await readJson(request);
        const camera = stringField(body.camera, 200) || "";
        const gear = stringField(body.gear, 2000) || "";
        await env.DB.prepare(`INSERT INTO user_gear (uid, camera, gear, updated_at)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(uid) DO UPDATE SET camera = excluded.camera, gear = excluded.gear, updated_at = excluded.updated_at`).bind(
          user.uid, camera, gear
        ).run();
        return json({ status: "saved", camera, gear });
      }
      if (url.pathname === "/api/profile/gear" && request.method === "GET") {
        await ensureUserGearTable(env.DB);
        const row = await env.DB.prepare("SELECT camera, gear FROM user_gear WHERE uid = ?").bind(user.uid).first();
        return json({ camera: row?.camera || "", gear: row?.gear || "" });
      }
      if (url.pathname === "/api/profile/photo" && request.method === "POST") {
        const viewer = await env.DB.prepare("SELECT status, role FROM users WHERE uid = ?").bind(user.uid).first();
        if (viewer?.status !== "approved") return json({ error: "forbidden" }, 403);
        const body = await readJson(request), image = validImageData(body.imageData, 300000);
        if (!image) return json({ error: "profile_photo_required_under_300kb" }, 400);
        if (viewer.role === "superAdmin") {
          await env.DB.prepare("UPDATE users SET photo_data = ? WHERE uid = ? AND status = 'approved' AND role = 'superAdmin'").bind(image, user.uid).run();
          return json({ status: "updated" });
        }
        const id = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO profile_photo_proposals (id, uid, image_data, status, submitted_at) VALUES (?, ?, ?, 'pending', datetime('now'))").bind(id, user.uid, image).run();
        return json({ proposalId: id, status: "pending" }, 201);
      }
      if (url.pathname === "/api/admin/profile-photos" && request.method === "GET") {
        if (!await isSuperAdmin(env.DB, user.uid, user.email)) return json({ error: "forbidden" }, 403);
        const rows = await env.DB.prepare(`SELECT p.id, p.uid, u.display_name, p.image_data, p.submitted_at
          FROM profile_photo_proposals p JOIN users u ON u.uid = p.uid WHERE p.status = 'pending' ORDER BY p.submitted_at LIMIT 100`).all();
        return json({ proposals: rows.results || [] });
      }
      const photoReview = url.pathname.match(/^\/api\/admin\/profile-photos\/([^/]+)$/);
      if (photoReview && request.method === "POST") {
        if (!await isSuperAdmin(env.DB, user.uid, user.email)) return json({ error: "forbidden" }, 403);
        const body = await readJson(request);
        if (!new Set(["approve", "reject"]).has(body.action)) return json({ error: "invalid_action" }, 400);
        const id = decodeURIComponent(photoReview[1]);
        const proposal = await env.DB.prepare("SELECT uid, image_data FROM profile_photo_proposals WHERE id = ? AND status = 'pending'").bind(id).first();
        if (!proposal) return json({ error: "proposal_not_pending" }, 409);
        if (body.action === "approve") {
          await env.DB.batch([
            env.DB.prepare("UPDATE users SET photo_data = ? WHERE uid = ?").bind(proposal.image_data, proposal.uid),
            env.DB.prepare("UPDATE profile_photo_proposals SET status = 'approved', reviewed_by_uid = ?, reviewed_at = datetime('now') WHERE id = ? AND status = 'pending'").bind(user.uid, id),
          ]);
        } else await env.DB.prepare("UPDATE profile_photo_proposals SET status = 'rejected', reviewed_by_uid = ?, reviewed_at = datetime('now') WHERE id = ? AND status = 'pending'").bind(user.uid, id).run();
        return json({ status: body.action === "approve" ? "approved" : "rejected" });
      }
      if (url.pathname === "/api/member-portraits" && request.method === "GET") {
        const rows = await env.DB.prepare("SELECT uid, display_name, photo_data FROM users WHERE photo_data IS NOT NULL").all();
        return json({ portraits: rows.results || [] });
      }
      if (url.pathname === "/api/admin/member-photo" && request.method === "POST") {
        const isSuper = await isSuperAdmin(env.DB, user.uid, user.email);
        const body = await readJson(request);
        const memberName = stringField(body.memberName, 100);
        const image = validImageData(body.imageData, 300000);
        if (!memberName || !image) return json({ error: "invalid_photo_request" }, 400);
        const uid = body.memberUid || memberName.toLowerCase().replace(/[^a-z0-9]/g, '-');
        if (!isSuper && user.uid !== uid) return json({ error: "forbidden" }, 403);
        const mockEmail = (uid.replace(/[^a-z0-9]/g, '') || 'member') + '@chitrakatha.internal';
        await env.DB.prepare(`INSERT INTO users (uid, email, display_name, status, role, photo_data, created_at)
          VALUES (?, ?, ?, 'approved', 'freelancer', ?, datetime('now'))
          ON CONFLICT(uid) DO UPDATE SET photo_data = excluded.photo_data, display_name = excluded.display_name`).bind(
          uid, mockEmail, memberName, image
        ).run();
        await dispatchWorkNotifications(env.DB, {
          actorUid: user.uid,
          actorName: "Chitrakatha Studio",
          ownerUid: uid,
          ownerName: memberName,
          kind: "portrait_updated",
          title: "Portrait updated",
          message: `Your studio portrait for ${memberName} has been updated.`
        });
        return json({ ok: true, memberName, uid });
      }
      return json({ error: "not_found" }, 404);
    } catch (error) {
      const status = error instanceof AuthError ? error.status : error instanceof SyntaxError ? 400 : 500;
      return json({ error: status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status === 400 ? "invalid_request" : "server_error" }, status);
    }
  },
};

class AuthError extends Error { constructor(status = 401) { super("Unauthorized"); this.status = status; } }

async function authenticate(request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new AuthError();
  const [encodedHeader, encodedPayload, signature] = token.split(".");
  if (!signature) throw new AuthError();
  const header = decodePart(encodedHeader), claims = decodePart(encodedPayload);
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== "RS256" || !header.kid || claims.aud !== FIREBASE_PROJECT_ID ||
      claims.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}` ||
      !claims.sub || typeof claims.sub !== "string" || claims.sub.length > 128 ||
      !claims.exp || claims.exp <= now || !claims.iat || claims.iat > now + 60) throw new AuthError();
  const keys = await getFirebaseKeys();
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new AuthError();
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromBase64Url(signature), data)) throw new AuthError();
  return { uid: claims.sub, email: typeof claims.email === "string" ? claims.email : "", name: typeof claims.name === "string" ? claims.name : "" };
}

let keysPromise;
async function getFirebaseKeys() {
  if (!keysPromise) keysPromise = fetch(FIREBASE_CERTS_URL).then(async (response) => {
    if (!response.ok) throw new Error("Unable to verify sign-in token");
    const body = await response.json();
    return body.keys || [];
  }).catch((error) => { keysPromise = null; throw error; });
  return keysPromise;
}

function decodePart(part) {
  try { return JSON.parse(new TextDecoder().decode(fromBase64Url(part))); }
  catch { throw new AuthError(); }
}
function fromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
function normalizeOwnerUid(uid) {
  if (!uid) return uid;
  if (uid === "upasak-mukherjee" || uid === "upasak") return "DdVRg5L8evXTdDtEN7WTDWOrZ2u1";
  if (uid === "deep" || uid === "deep-shekhar") return "T4zlc28hy7Tth6wIbWnKZlWotvS2";
  if (uid === "sandip" || uid === "sandip-pal") return "xri4yPGgxbWiUiljqIEUYOfsf8M2";
  return uid;
}

function stringField(value, max) { return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : ""; }
async function isSuperAdmin(db, uid, email) {
  if (email && String(email).trim().toLowerCase() === "dknfbc@gmail.com") return true;
  const row = await db.prepare("SELECT email FROM users WHERE uid = ? AND status = 'approved' AND role = 'superAdmin'").bind(uid).first();
  if (row) return true;
  return false;
}
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value ? value : "";
}
function validImageData(value, max) {
  if (typeof value !== "string" || value.length > max) return "";
  return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : "";
}
async function readJson(request) {
  if (Number(request.headers.get("content-length") || 0) > 450000) throw new SyntaxError("Body too large");
  const text = await request.text();
  if (text.length > 450000) throw new SyntaxError("Body too large");
  return JSON.parse(text);
}
function corsHeaders(request) {
  const origin = new URL(request.url).origin;
  return { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS", "access-control-allow-headers": "authorization, content-type", "vary": "Origin" };
}
