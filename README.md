# Harmony Sounds — Deploy Guide

Everything is built. Three steps left, about 15 minutes total.

## 1. Set up the database (5 min)

1. Go to your Supabase project → **SQL Editor** → **New query**.
2. Open `supabase-setup.sql` from this folder, copy all of it, paste it in, and click **Run**.
3. That's it — this creates every table, the security rules (so staff only see their own events, drivers only see their own trips, etc.), and the "first person to sign in becomes admin" logic.

## 2. Push the code to GitHub (5 min)

1. Go to [github.com/new](https://github.com/new), create a new **private** repository (e.g. `harmony-sounds`).
2. On your computer, in this folder:
   ```
   git init
   git add .
   git commit -m "Harmony Sounds"
   git branch -M main
   git remote add origin <the URL GitHub gives you>
   git push -u origin main
   ```
   (`.env.local` is already excluded via `.gitignore` — your Supabase key won't be committed, which is fine either way since it's the public key, but keeping it out is good practice.)

## 3. Deploy on Vercel (5 min)

1. Go to [vercel.com](https://vercel.com), sign up/log in with your GitHub account.
2. Click **Add New → Project**, pick your `harmony-sounds` repo, click **Import**.
3. Before deploying, open **Environment Variables** and add:
   - `VITE_SUPABASE_URL` = `https://aozydkefalibsadbtpeh.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `sb_publishable_0ZFC0R9ogYObElPN14pQuQ_Vl3Z1str`
4. Click **Deploy**. In about a minute you'll get a live link like `harmony-sounds.vercel.app`.

## 4. One last setting — tell Supabase about your live link

Magic-link emails need to know where to send people back to.

1. In Supabase: **Authentication → URL Configuration**.
2. Set **Site URL** to your Vercel link (e.g. `https://harmony-sounds.vercel.app`).
3. Under **Redirect URLs**, add the same link.
4. Save.

## You're live

- Open your Vercel link, enter your email, and sign in — since you're the first person ever, you're automatically the admin.
- Go to **Team**, invite everyone else by name, email, and role. Each person gets a real email with a sign-in link and lands straight on their role's dashboard.
- Everyone sees the same live data — when the warehouse manager scans something out, the admin sees it update immediately.

## Good to know

- **Email deliverability**: Supabase's built-in email works out of the box but is rate-limited and can land in spam. For real production use, connect a custom SMTP provider (e.g. Resend, Postmark) under Authentication → Email settings — it's a 5-minute setup whenever you're ready.
- **Odometer photo checking** calls Claude's API directly from the browser to check clarity and read the mileage — no extra setup needed, it just works once deployed.
- **Fixing a role**: if someone signs in without being invited first, they're let in as Staff by default so nobody's locked out — an admin can fix their role from the Team page.
- Local testing before deploying: `npm install` then `npm run dev` (uses the same Supabase project via `.env.local`).
