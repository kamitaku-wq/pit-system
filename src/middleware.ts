import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

function getSupabaseConfig(): { supabaseUrl: string; supabaseAnonKey: string } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  }

  return { supabaseUrl, supabaseAnonKey };
}

function copyCookies(source: NextResponse, target: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie);
  });

  return target;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig();
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        cookiesToSet.forEach(({ name, value }: { name: string; value: string; options: CookieOptions }) => {
          request.cookies.set(name, value);
        });

        supabaseResponse = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }: { name: string; value: string; options: CookieOptions }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isLoginPath = pathname === "/vendor/login";
  const isInvitationPath = pathname.startsWith("/vendor/invitations/");

  if (!user && !isLoginPath && !isInvitationPath) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/vendor/login";
    redirectUrl.search = "";

    return copyCookies(supabaseResponse, NextResponse.redirect(redirectUrl));
  }

  if (user && isLoginPath) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/vendor/requests";
    redirectUrl.search = "";

    return copyCookies(supabaseResponse, NextResponse.redirect(redirectUrl));
  }

  return supabaseResponse;
}

export const config = { matcher: ["/vendor/:path*"] };
