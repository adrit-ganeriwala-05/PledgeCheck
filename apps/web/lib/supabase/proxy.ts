// Session refresh for proxy.ts: keeps the Supabase auth cookie fresh on each request so
// server components and route handlers see a valid session. Performs no redirects;
// access control lives in RLS and in each route.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "./types";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Not configured (e.g. local build without env). Data access still fails loudly
    // through lib/env when it is attempted.
    return response;
  }

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Validates the JWT with Supabase Auth and triggers a refresh when needed.
  await supabase.auth.getUser();

  return response;
}
