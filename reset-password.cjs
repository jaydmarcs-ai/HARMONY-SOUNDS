const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return { statusCode: 401, body: JSON.stringify({ error: "Missing session token" }) };
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "Server is missing required configuration" }) };
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userErr } = await callerClient.auth.getUser(token);
    if (userErr || !userData || !userData.user) {
      return { statusCode: 401, body: JSON.stringify({ error: "Invalid session" }) };
    }

    const { data: callerProfile } = await callerClient
      .from("profiles")
      .select("role")
      .eq("auth_user_id", userData.user.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== "admin") {
      return { statusCode: 403, body: JSON.stringify({ error: "Only admins can reset passwords" }) };
    }

    const body = JSON.parse(event.body || "{}");
    const { email, newPassword } = body;
    if (!email || !newPassword) {
      return { statusCode: 400, body: JSON.stringify({ error: "Email and new password are required" }) };
    }
    if (newPassword.length < 6) {
      return { statusCode: 400, body: JSON.stringify({ error: "Password must be at least 6 characters" }) };
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: targetProfile, error: profileErr } = await adminClient
      .from("profiles")
      .select("auth_user_id")
      .eq("email", email)
      .maybeSingle();

    if (profileErr || !targetProfile || !targetProfile.auth_user_id) {
      return { statusCode: 404, body: JSON.stringify({ error: "That person hasn't registered an account yet — nothing to reset" }) };
    }

    const { error: updateErr } = await adminClient.auth.admin.updateUserById(targetProfile.auth_user_id, {
      password: newPassword,
    });

    if (updateErr) {
      return { statusCode: 500, body: JSON.stringify({ error: updateErr.message }) };
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error("reset-password error:", err);
    const message = (err && (err.message || (err.toString && err.toString()))) || "Unexpected server error";
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
};
