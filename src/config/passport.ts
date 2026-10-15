import passport from 'passport';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as InstagramStrategy } from 'passport-instagram';
import { ENV } from './env.js';
import { prisma } from './prisma.js';

// JWT Strategy
passport.use(
  new JwtStrategy(
    {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: ENV.JWT_SECRET,
    },
    async (payload, done) => {
      try {
        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          select: {
            id: true,
            username: true,
            handle: true,
            email: true,
            role: true,
            avatar: true,
            level: true,
            bio: true,
            badges: true,
            igAccount: true,
            followersCount: true,
            followingCount: true,
            fessCount: true,
            balance: true,
            revenue: true,
            isBanned: true,
            createdAt: true,
          },
        });

        if (!user || user.isBanned) {
          return done(null, false);
        }

        return done(null, user);
      } catch (error) {
        return done(error, false);
      }
    }
  )
);

// Google OAuth Strategy
if (ENV.GOOGLE_CLIENT_ID && ENV.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: ENV.GOOGLE_CLIENT_ID,
        clientSecret: ENV.GOOGLE_CLIENT_SECRET,
        callbackURL: ENV.GOOGLE_CALLBACK_URL,
        passReqToCallback: true,
      },
      async (req, accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          const googleId = profile.id;
          const displayName = profile.displayName || 'Google User';
          const avatar = profile.photos?.[0]?.value;

          // Portal picked on the login/register page is round-tripped through
          // Google as the OAuth `state` (see GET /auth/google).
          const stateRole = typeof req.query?.state === 'string' ? req.query.state : '';
          const role = stateRole === 'Base Admin' ? 'Base Admin' : 'User';

          // Check if user already exists
          let user = await prisma.user.findFirst({
            where: {
              OR: [
                { googleId },
                ...(email ? [{ email }] : []),
              ],
            },
          });

          // Banned accounts never complete a Google sign-in.
          if (user?.isBanned) {
            return done(null, false);
          }

          if (!user) {
            // Auto register
            const rawHandle = '@' + (profile.username || displayName.toLowerCase().replace(/[^a-z0-9_]/g, '') || `user_${Date.now()}`);
            let cleanHandle = rawHandle.slice(0, 20);

            // Ensure unique handle
            const existingHandle = await prisma.user.findUnique({ where: { handle: cleanHandle } });
            if (existingHandle) {
              cleanHandle = `@u_${Date.now().toString().slice(-6)}`;
            }

            user = await prisma.user.create({
              data: {
                googleId,
                email: email || undefined,
                username: displayName,
                handle: cleanHandle,
                avatar,
                role,
                bio: 'Joined via Google Sign-In',
              },
            });
          } else if (!user.googleId) {
            // Link googleId
            user = await prisma.user.update({
              where: { id: user.id },
              data: { googleId },
            });
          }

          return done(null, user);
        } catch (error) {
          return done(error as Error, undefined);
        }
      }
    )
  );
}

// Instagram Strategy (Meta for Developers)
if (ENV.INSTAGRAM_CLIENT_ID && ENV.INSTAGRAM_CLIENT_SECRET) {
  passport.use(
    new InstagramStrategy(
      {
        clientID: ENV.INSTAGRAM_CLIENT_ID,
        clientSecret: ENV.INSTAGRAM_CLIENT_SECRET,
        callbackURL: ENV.INSTAGRAM_CALLBACK_URL,
        passReqToCallback: true,
      },
      async (req, accessToken, refreshToken, profile, done) => {
        try {
          const instagramId = profile.id;
          const igUsername = '@' + (profile.username || `ig_${profile.id}`);

          // If user is already authenticated via JWT, link to current user
          const currentUser = (req as any).user;
          if (currentUser?.id) {
            const updated = await prisma.user.update({
              where: { id: currentUser.id },
              data: {
                instagramId,
                igAccount: igUsername,
              },
            });

            // Also create or update PlatformConnection
            await prisma.platformConnection.upsert({
              where: {
                userId_platform: {
                  userId: currentUser.id,
                  platform: 'instagram',
                },
              },
              create: {
                userId: currentUser.id,
                platform: 'instagram',
                name: 'Instagram Graph API',
                status: 'connected',
                connected: true,
                accountHandle: igUsername,
                accessToken,
                refreshToken,
              },
              update: {
                status: 'connected',
                connected: true,
                accountHandle: igUsername,
                accessToken,
                refreshToken,
              },
            });

            return done(null, updated);
          }

          // Otherwise, find or create user with Instagram ID
          let user = await prisma.user.findUnique({
            where: { instagramId },
          });

          if (!user) {
            user = await prisma.user.create({
              data: {
                instagramId,
                igAccount: igUsername,
                username: profile.displayName || profile.username || 'IG User',
                handle: igUsername,
                role: 'Base Admin',
                bio: `Official verified Instagram account: ${igUsername}`,
              },
            });
          }

          return done(null, user);
        } catch (error) {
          return done(error as Error, undefined);
        }
      }
    )
  );
}

export default passport;
