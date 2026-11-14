# My To-Do — Android app + web version

A simple to-do app with three categories (**Personal**, **L'Hippopotame**, **Gold Fields**), priorities and due dates.
Tasks sync between your Android phone and your computer through your own free Firebase database.

- **Android:** GitHub builds the app (`MyToDo.apk`) automatically and posts it on the repo's **Releases** page.
- **Computer:** the same app runs as a web page at `https://<your-github-username>.github.io/my-todo-app/`.

Total setup time: about 20 minutes, once.

---

## 1. Create the Firebase database (free)

1. Go to <https://console.firebase.google.com> and sign in with your Google account.
2. **Create a project** → name it `my-todo` → you can turn Google Analytics **off** → Create.
3. Left menu **Build → Authentication** → **Get started** → **Email/Password** → turn on the first switch → **Save**.
4. Left menu **Build → Firestore Database** → **Create database** →
   location `northamerica-northeast1 (Montréal)` → **Start in production mode** → Create.
5. In Firestore, open the **Rules** tab, replace everything with the contents of `firestore.rules` from this folder, and click **Publish**.
   (This makes sure only you can see your tasks.)
6. Click the gear ⚙️ next to *Project Overview* → **Project settings** → scroll to *Your apps* → click the **web icon `</>`** →
   nickname `my-todo` → **Register app**. Firebase shows a block like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza…",
     authDomain: "my-todo-xxxx.firebaseapp.com",
     projectId: "my-todo-xxxx",
     ...
   };
   ```
   Keep this page open — you'll paste these values in step 2.

## 2. Put the code on GitHub

1. Create a free account at <https://github.com> if you don't have one.
2. Create a **new public repository** named `my-todo-app` (public is required for the free web page).
3. Upload every file and folder in this package, **including the hidden `.github` folder**.
   *Easiest:* connect GitHub to Claude (claude.ai → Settings → Connectors) and ask Claude to push it for you.
4. In the repo, open `src/firebase-config.js`, click the ✏️ pencil, replace each `PASTE_…` value with the matching value from Firebase, and **Commit changes**.

## 3. Turn on the build and the web page

1. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Open the **Actions** tab. If asked, click *I understand… enable workflows*. Then click **Build app → Run workflow**.
3. Wait about 5 minutes for both jobs to show a green ✓.

## 4. Install on your Android phone

1. On your phone, open `https://github.com/<your-username>/my-todo-app/releases/latest`.
2. Tap **MyToDo.apk** to download it, then open it.
3. Android will ask to allow installs from your browser — allow it, then tap **Install**.
   (Play Protect may warn that the app is from an unknown developer — that's you. Tap *Install anyway*.)
4. Open **My To-Do**, tap **Create account**, and pick an email + password.

## 5. Use it on your computer

Open `https://<your-username>.github.io/my-todo-app/` and **sign in** with the same email and password. Bookmark it.

---

## Updating the app

Any change committed to the repo rebuilds both versions automatically. To update the phone app, download the new
`MyToDo.apk` from the Releases page and install it over the old one — your tasks stay (they live in Firebase).

## Files

| File | What it is |
| --- | --- |
| `www/index.html` | The app's screen and styles |
| `src/app.js` | App logic: tasks, sign-in, sync |
| `src/firebase-config.js` | **Your Firebase settings — edit this** |
| `firestore.rules` | Database security rules (paste into Firebase) |
| `.github/workflows/build.yml` | GitHub's build instructions (APK + web page) |
| `keystore/debug.keystore` | Signing key so app updates install over the old version |
| `capacitor.config.json` | Android app name and id |

## Troubleshooting

- **"Email sign-in isn't turned on"** → redo step 1.3.
- **"Couldn't load your list: permission-denied"** → redo step 1.5 (rules).
- **"Setup needed: paste your Firebase config"** → redo step 2.4, then wait for the rebuild.
- **App won't install over the old one** → uninstall it first (your tasks are safe in Firebase), then install the new APK.
