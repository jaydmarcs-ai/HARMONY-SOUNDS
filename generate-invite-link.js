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

    // Verify the caller is a real logged-in admin before doing anything privileged.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userErr } = await callerClient.auth.getUser(token);
    if (userErr || !userData || !userData.user) {
      return { statusCode: 401, body: JSON.stringify({ error: "Invalid session" }) };
    }

    const { data: profile } = await callerClient
      .from("profiles")
      .select("role")
      .eq("auth_user_id", userData.user.id)
      .maybeSingle();

    if (!profile || profile.role !== "admin") {
      return { statusCode: 403, body: JSON.stringify({ error: "Only admins can generate invite links" }) };
    }

    const body = JSON.parse(event.body || "{}");
    const email = body.email;
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: "Email is required" }) };
    }

    // This client uses the service role key — full admin power, server-side only, never sent to the browser.
    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data, error } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: process.env.SITE_URL || supabaseUrl },
    });

    if (error) {
      return { statusCode: 500, body: JSON.stringify({ error: error.message || "Supabase rejected the request" }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ link: data.properties.action_link }),
    };
  } catch (err) {
    console.error("generate-invite-link error:", err);
    const message = (err && (err.message || err.toString && err.toString())) || "Unexpected server error";
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
};
