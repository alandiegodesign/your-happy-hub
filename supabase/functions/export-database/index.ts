import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Check admin or desenvolvedor role
    const { data: roles } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    const userRoles = (roles || []).map((r: any) => r.role);
    if (!userRoles.includes("admin") && !userRoles.includes("desenvolvedor")) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { resource } = body;

    // Export table data
    if (resource === "tables") {
      const tables = ["profiles", "events", "ticket_locations", "orders", "order_items", "user_roles"];
      const result: Record<string, any[]> = {};
      for (const table of tables) {
        const { data, error } = await adminClient.from(table).select("*").limit(10000);
        result[table] = error ? [] : (data || []);
      }
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Export users from auth
    if (resource === "users") {
      const { data, error } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
      const users = (data?.users || []).map((u: any) => ({
        id: u.id,
        email: u.email,
        phone: u.phone,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        email_confirmed_at: u.email_confirmed_at,
        user_metadata_name: u.user_metadata?.name || "",
        user_metadata_user_type: u.user_metadata?.user_type || "",
      }));
      return new Response(JSON.stringify({ users }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Export storage buckets info
    if (resource === "storage") {
      const { data: buckets } = await adminClient.storage.listBuckets();
      const bucketInfo: any[] = [];
      for (const bucket of (buckets || [])) {
        const { data: files } = await adminClient.storage.from(bucket.name).list("", { limit: 1000 });
        bucketInfo.push({
          bucket_name: bucket.name,
          public: bucket.public,
          file_count: (files || []).length,
          files: (files || []).map((f: any) => ({
            name: f.name,
            size: f.metadata?.size || 0,
            created_at: f.created_at,
            updated_at: f.updated_at,
          })),
        });
      }
      return new Response(JSON.stringify({ storage: bucketInfo }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Export edge functions list
    if (resource === "edge_functions") {
      const knownFunctions = [
        "create-checkout", "get-events", "get-stripe-key",
        "purge-deleted-events", "verify-payment", "admin-credentials", "export-database",
      ];
      return new Response(JSON.stringify({ edge_functions: knownFunctions }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Export secrets names
    if (resource === "secrets") {
      const allEnv = Deno.env.toObject();
      const systemVars = ["PATH", "HOME", "DENO_DIR", "HOSTNAME", "PORT", "TMPDIR", "USER", "LANG", "TERM", "DENO_REGION", "DENO_DEPLOYMENT_ID"];
      const secretNames: string[] = [];
      for (const key of Object.keys(allEnv)) {
        if (systemVars.includes(key) || key.startsWith("XDG")) continue;
        secretNames.push(key);
      }
      return new Response(JSON.stringify({ secrets: secretNames }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Export DB functions
    if (resource === "db_functions") {
      try {
        const { data } = await adminClient.rpc("exec_sql", {
          sql_query: `SELECT routine_name, routine_type, data_type 
                      FROM information_schema.routines 
                      WHERE routine_schema = 'public' 
                      ORDER BY routine_name`,
        });
        return new Response(JSON.stringify({ db_functions: data || [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch {
        return new Response(JSON.stringify({ db_functions: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Export RLS policies
    if (resource === "rls_policies") {
      try {
        const { data } = await adminClient.rpc("exec_sql", {
          sql_query: `SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check 
                      FROM pg_policies 
                      WHERE schemaname = 'public' 
                      ORDER BY tablename, policyname`,
        });
        return new Response(JSON.stringify({ rls_policies: data || [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch {
        return new Response(JSON.stringify({ rls_policies: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "Invalid resource" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
