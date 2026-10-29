# Nørre News · Writers' Desk

The login site where the two writers write and publish sections of
Nørre News. Posts are stored in Firebase (Firestore) and appear on the
public newsletter site straight away. No git push needed.

## Files
- `index.html`, `admin.css`, `admin.js`: the writer site
- `firebase-config.js`: your Firebase settings (same as in the newsletter folder)
- `firestore.rules`: security rules to paste into Firebase

## One-time Firebase setup
1. Go to https://console.firebase.google.com → **Add project** → name it
   `norre-news` → you can turn Google Analytics off → **Create**.
2. **Build → Firestore Database → Create database** → pick a location in
   Europe (e.g. `eur3`) → **Start in production mode**.
3. **Build → Authentication → Get started → Email/Password** → enable the
   first switch → **Save**.
4. **Authentication → Users → Add user**: add each writer's email and a
   password (twice, once per writer).
5. **Authentication → Settings → User actions**: untick **Enable create
   (sign-up)** so nobody else can make an account.
6. **Firestore Database → Rules**: paste the contents of `firestore.rules`,
   replace the two example emails with your writers' emails → **Publish**.
7. **Project settings (gear icon) → Your apps → Web (</>)** → register an
   app called `norre-news` (no hosting) → copy the `firebaseConfig` values
   into `firebase-config.js` here AND in the newsletter folder.

## Changing writers later
Add or remove users in **Authentication → Users**, and update the email
list in the Firestore rules.
