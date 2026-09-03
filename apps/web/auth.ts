import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import type { EmailConfig } from 'next-auth/providers';
import { PssAdapter } from './app/lib/pss-adapter';
import { getAuthStore } from './app/lib/stores';

const DEV_LOGIN = process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_LOGIN === '1';

async function logMagicLink(identifier: string, url: string): Promise<void> {
  const line = `${new Date().toISOString()}  ${identifier}  ${url}\n`;
  console.log(`\n🔑  Magic link for ${identifier}:\n    ${url}\n`);
  try {
    const dir = join(process.cwd(), '..', '..', '.data', 'auth');
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, 'magic-links.log'), line);
  } catch {
    /* console log is enough */
  }
}

// Inline email provider — a real magic link, but the "transport" just records
// the URL (dev). Swap `sendVerificationRequest` for SMTP/Resend in production.
const DevEmail: EmailConfig = {
  id: 'email',
  type: 'email',
  name: 'Email',
  from: process.env.EMAIL_FROM ?? 'no-reply@put-sell-screener.local',
  maxAge: 24 * 60 * 60,
  sendVerificationRequest: async ({ identifier, url }) => {
    await logMagicLink(identifier, url);
  },
  options: {},
} as EmailConfig;

const providers: NextAuthConfig['providers'] = [DevEmail];

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google);
}

if (DEV_LOGIN) {
  providers.push(
    Credentials({
      id: 'dev',
      name: 'Dev login',
      credentials: { email: { label: 'Email', type: 'email' } },
      async authorize(creds) {
        const email = String(creds?.email ?? '').trim().toLowerCase();
        if (!email || !email.includes('@')) return null;
        const user = await getAuthStore().createUser({ email, name: email.split('@')[0] });
        return { id: user.id, email: user.email, name: user.name ?? undefined };
      },
    }),
  );
}

export const config: NextAuthConfig = {
  adapter: PssAdapter(getAuthStore()),
  session: { strategy: 'jwt' },
  pages: { signIn: '/signin', error: '/signin' },
  providers,
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = String(token.uid);
      return session;
    },
  },
  trustHost: true,
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);
